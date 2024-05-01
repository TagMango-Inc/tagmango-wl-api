import fs from 'fs';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import mongoose from 'mongoose';

import CustomHostModel from '../models/customHost.model';
import executeCommands from '../utils/executeCommands';

const router = new Hono();

/**
*! Protected Routes
** App Router 
/wl/apps/
/wl/apps/{:id} [ GET PATCH ]
/wl/apps/{:id}/deploy/{:android|ios} [ GET ]  [sse]  [ fetching all the required data for the build process  from database without passing it through query params ]
/wl/apps/{:id}/upload/asset [ POST ]  [ ":id" is for future purpose, may be someday we may have to upload the asset to S3 and store the URL in the database.]
*/

/**
    /wl/apps/
    GET
    Get all custom hosts
    Protected Route
    Accepted Query Params: page, limit, search
    Default: page = 1, limit = 10, search = ''
*/
router.get('/', async (c) => {
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
      .sort({ updatedAt: -1 })
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

/**
    /wl/apps/{:id
    GET
    Get custom host by id
    Protected Route
*/
router.get('/:id', async (c) => {
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

/**
    /wl/apps/{:id}/deploy/{:target}
    GET
    Deploy custom host for android | ios
    Protected Route
    target = android | ios
*/
router.get('/:id/deploy/:target', async (c) => {
  const { id, target } = c.req.param();
  const customHosts = await CustomHostModel.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    {
      $project: {
        colors: 1,
        onesignalAppId: 1,
        appName: 1,
        deploymentDetails: 1,
        host: 1,
        androidBundleId: '$androidDeepLinkConfig.target.package_name',
        iosBundleId: '$iosDeepLinkConfig.applinks.details.appID',
      },
    },
  ]);

  if (customHosts.length === 0) {
    return c.json(
      { message: 'Custom Host not found' },
      { status: 404, statusText: 'Not Found' }
    );
  }

  const customHost = customHosts[0];
  const {
    colors,
    onesignalAppId,
    appName,
    deploymentDetails,
    host,
    androidBundleId,
    iosBundleId,
  } = customHost;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: `${JSON.stringify(customHost)}`,
    });

    await stream.writeSSE({
      data: '__________________________ INSTALLING DEPENDENCIES __________________________',
    }); // Send output to client

    await executeCommands(
      ['cd deployments', 'npm install'],
      'Install Dependencies',
      stream
    );

    // Start npm run build process
    await stream.writeSSE({
      data: '__________________________ BUILDING __________________________',
    }); // Send output to client
  });
});

/**
    /wl/apps/{:id}/upload/asset
    POST
    Protected Route
*/
router.post('/:id/upload/asset', async (c) => {
  try {
    const body = await c.req.parseBody({
      all: true,
    });
    const file = body['file'];
    const uploadPath = './uploads';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, {
        recursive: true,
      });
    }

    if (file instanceof File) {
      const filePath = `${uploadPath}/${file.name}`;
      const buffer = await file.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(buffer));
      return c.json(
        {
          message: 'File uploaded successfully',
          result: {
            path: filePath,
          },
        },
        {
          status: 200,
          statusText: 'OK',
        }
      );
    } else {
      return c.json(
        {
          message: 'Invalid file',
          result: null,
        },
        {
          status: 400,
          statusText: 'Bad Request',
        }
      );
    }
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

export default router;
