// test
fetch("http://localhost:3000/api/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base64Image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", ocrText: "", mcqMode: false, isBilingual: false, includeImages: false, numberingStyle: "none" })
})
  .then(async r => {
    const text = await r.text();
    console.log("Status:", r.status);
    console.log("Body:", text);
  })
  .catch(console.error);
