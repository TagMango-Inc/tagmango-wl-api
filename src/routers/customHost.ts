import { Hono } from 'hono';

import CustomHostModel from '../models/customHost.model';

const appRouter = new Hono();

appRouter.get('/:id', async (c) => {
  try {
    const { id } = c.req.param();
    const customHost = await CustomHostModel.findById(id);
    if (!customHost) {
      return c.json(
        { message: 'Custom Host not found' },
        { status: 404, statusText: 'Not Found' }
      );
    }
    return c.json(
      { message: 'Fetched Custom Host', result: customHost },
      { status: 200, statusText: 'OK' }
    );
  } catch (error) {
    return c.json(
      { message: 'Internal Server Error' },
      { status: 500, statusText: 'Internal Server Error' }
    );
  }
});

export default appRouter;
