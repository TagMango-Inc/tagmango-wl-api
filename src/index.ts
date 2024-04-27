import 'dotenv/config';

import { Hono } from 'hono';

import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/', (c) => {
  const DB_URI = process.env.DB_URI;
  console.log('DB_URI:', DB_URI);
  return c.json({
    message: 'Hello World',
    DB_URI,
  });
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
