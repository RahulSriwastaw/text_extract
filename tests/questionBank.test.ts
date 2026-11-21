import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerQuestionBank } from "../api/questionBank.js";
import { saveQuestions } from "../api/questionSheet.js";
import { MOCKTEST_CSV_HEADERS } from "../services/mcqColumns.js";

test("personal storage routes require sign-in even when general access is anonymous", async () => {
  const app = express();
  app.use(express.json());
  registerQuestionBank(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const endpoint of [
      "profile",
      "document",
      "questions",
      "disable",
      "oauth/airtable",
    ]) {
      const response = await fetch(
        "http://127.0.0.1:" + address.port + "/api/qb/" + endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      assert.equal(response.status, 401, endpoint);
    }
  } finally {
    server.close();
  }
});

test("personal sheet uses chosen Google token, maintains a 34-column export and updates the same row on retry", async () => {
  const orig = globalThis.fetch;
  let batches: any[][] = [],
    grids: any[] = [],
    columns: string[] = [];
  const key = JSON.stringify(["user-a", "q1"]);
  globalThis.fetch = async (input, init) => {
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      "Bearer personal-test",
    );
    const url = String(input);
    assert.ok(
      url.startsWith(
        "https://sheets.googleapis.com/v4/spreadsheets/personal-sheet",
      ),
    );
    let data: unknown;
    if (url.includes(":batchUpdate")) {
      const requests = JSON.parse(String(init.body)).requests;
      batches.push(requests);
      if (!grids.length) {
        grids = requests
          .filter((r: any) => r.addSheet)
          .map((r: any) => ({ properties: r.addSheet.properties }));
        const questionCells = requests.find(
          (r: any) =>
            r.updateCells?.start.sheetId === grids[0].properties.sheetId,
        );
        columns = questionCells.updateCells.rows[0].values.map(
          (v: any) => v.userEnteredValue.stringValue,
        );
      }
      data = {};
    } else if (url.includes("batchGet"))
      data = {
        valueRanges: [
          { values: [columns] },
          { values: [["storage_id"], [key]] },
        ],
      };
    else if (url.includes("valueRenderOption"))
      data = { values: [["=ARRAYFORMULA(Questions!D:AK)"]] };
    else data = { sheets: grids };
    return Response.json(data);
  };
  try {
    for (const answer of ["A", "B"])
      await saveQuestions("user-a", [{ id: "q1", answer }], "Test", {
        id: "personal-sheet",
        token: "personal-test",
      });
    assert.equal(
      grids.find((g) => g.properties.title === "Export").properties
        .gridProperties.columnCount,
      MOCKTEST_CSV_HEADERS.length,
    );
    assert.equal(batches[1].length, 1);
    const patch = batches[1][0].updateCells;
    assert.equal(patch.start.rowIndex, 1);
    assert.equal(
      patch.rows[0].values[columns.indexOf("answer")].userEnteredValue
        .stringValue,
      "B",
    );
  } finally {
    globalThis.fetch = orig;
  }
});
