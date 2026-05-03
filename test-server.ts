// test server
import express from 'express';
import api from './api/index.js';
const app = express();
app.use(api);
app.listen(3001, () => {
  console.log("Server started on 3001");
});
