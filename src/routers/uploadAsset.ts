import fs from 'fs';
import { Hono } from 'hono';

const uploadAssetRouter = new Hono();

uploadAssetRouter.post('/', async (c) => {
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
export default uploadAssetRouter;
