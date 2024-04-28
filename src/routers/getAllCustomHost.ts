import { Hono } from 'hono';

import CustomHostModel from '../models/customHost.model';

const getAllCustomHostRouter = new Hono();

getAllCustomHostRouter.get('/', async (c) => {
  try {
    const { page, limit, search } = c.req.query();
    let PAGE = page ? parseInt(page as string) : 1;
    let LIMIT = limit ? parseInt(limit as string) : 10;
    let SEARCH = search ? (search as string) : '';

    const totalCustomHosts = await CustomHostModel.countDocuments();
    const customHosts = await CustomHostModel.find({
      $or: [
        { appName: { $regex: new RegExp(SEARCH, 'i') } },
        { host: { $regex: new RegExp(SEARCH, 'i') } },
        { brandname: { $regex: new RegExp(SEARCH, 'i') } },
      ],
    })
      .select('appName host logo createdAt updatedAt deploymentDetails')
      .skip((PAGE - 1) * LIMIT)
      .limit(LIMIT);

    const totalSearchResults = await CustomHostModel.find({
      $or: [
        { appName: { $regex: new RegExp(SEARCH, 'i') } },
        { host: { $regex: new RegExp(SEARCH, 'i') } },
        { brandname: { $regex: new RegExp(SEARCH, 'i') } },
      ],
    }).countDocuments();

    const hasNextPage = totalSearchResults > PAGE * LIMIT;

    return c.json(
      {
        message: 'All Custom Hosts',
        result: {
          customHosts,
          totalSearchResults,
          totalCustomHosts,
          currentPage: PAGE,
          nextPage: hasNextPage ? PAGE + 1 : -1,
          limit: LIMIT,
          hasNext: hasNextPage,
        },
      },
      {
        status: 200,
        statusText: 'OK',
      }
    );
  } catch (error) {
    return c.json(
      { message: 'Internal Server Error' },
      {
        status: 500,
        statusText: 'Internal Server Error',
      }
    );
  }
});

export default getAllCustomHostRouter;
