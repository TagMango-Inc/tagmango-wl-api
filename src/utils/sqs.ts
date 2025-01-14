import {
  SendMessageCommand,
  SendMessageCommandOutput,
  SQSClient,
} from '@aws-sdk/client-sqs';

const sqsClient =  new SQSClient({
  region: 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
});

export async function enqueueMessage(
  event: string,
  body: unknown,
  attributes: Record<string, string> = {},
): Promise<SendMessageCommandOutput | null> {
  try {
    const message = JSON.stringify(body);
    const params = {
      ...attributes,
      event,
    } as Record<string, unknown>;
    const messageAttributes = Object.keys(params).reduce(
      (acc, key) => {
        acc[key] = {
          DataType: 'String',
          StringValue: `${params[key]}`,
        };
        return acc;
      },
      {} as Record<
        string,
        {
          DataType: 'String';
          StringValue: string;
        }
      >,
    );
    const sendMessageCommand = new SendMessageCommand({
      DelaySeconds: 1,
      MessageAttributes: messageAttributes,
      MessageBody: message,
      QueueUrl: process.env.SQS_QUEUE_URL as string,
    });

    const response = await sqsClient.send(sendMessageCommand);
    console.log(response);
    return response;
  } catch (error) {
    return null;
  }
}