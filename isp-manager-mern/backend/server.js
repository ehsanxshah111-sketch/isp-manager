/**
 * NOTE: This file is kept only for backwards compatibility.
 * The single source of truth for the Express app (routes, CORS, DB connection)
 * is ./api/index.js — that's what "npm start" and Vercel both run.
 */
require('./api/index.js');
