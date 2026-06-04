require("dotenv").config();
const express = require("express");
const { serviceAuth } = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// // Capture raw body for HMAC verification before JSON parse
// app.use((req, res, next) => {
//   let data = '';
//   req.on('data', chunk => { data += chunk; });
//   req.on('end',  ()    => { req.rawBody = data; next(); });
// });

app.use(express.json());

// Service-level auth on all routes except /health
// app.use((req, res, next) => {
//   if (req.path === "/health") return next();
//   serviceAuth(req, res, next);
// });

// Routes
app.use("/", require("./routes/balance"));
app.use("/deposit", require("./routes/deposit"));
app.use("/withdrawal", require("./routes/withdrawal"));
app.use("/admin", require("./routes/admin"));

app.use(errorHandler);

module.exports = app;
