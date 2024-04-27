import { exec } from 'child_process';
import { SSEStreamingApi } from 'hono/streaming';
import { v4 as uuidv4 } from 'uuid';

async function executeCommands(
  command: string[],
  description = '',
  stream: SSEStreamingApi,
  cwd = process.cwd()
) {
  // * Initialize the combined command
  const combinedCommand = command.reduce((acc, curr, index) => {
    if (index === 0) return curr;
    return acc + ' && ' + curr;
  }, '');
  const taskId = uuidv4();

  // * Write the task to client
  await stream.writeSSE({
    data: formateMessage(`Initiated ${description}`, taskId, 'init'),
  });

  // * Execute the command
  try {
    const process = exec(combinedCommand, { cwd });

    const { stdout, stderr } = process;

    if (stdout) {
      stdout.on('data', (data) => {
        stream.writeSSE({
          data: formateMessage(data, taskId),
        });
      });
    }
    if (stderr) {
      stderr.on('data', (data) => {
        if (
          typeof data === 'string' &&
          (data.length < 10 ||
            data.toLowerCase().includes('warn') ||
            data.toLowerCase().includes('deprecate'))
        ) {
          stream.writeSSE({
            data: formateMessage(data, taskId, 'warning'),
          });
        } else {
          stream.writeSSE({
            data: formateMessage(data, taskId, 'error'),
          });
        }
      });
    }

    // * Wait for the process to finishs
    const code = await new Promise((resolve, reject) => {
      process.on('close', resolve);
      process.on('error', reject);
    });

    // * Write the result to client
    // * If the code is 0, then the command was successful
    if (code === 0) {
      stream.writeSSE({
        data: formateMessage(`Finished ${description}`, taskId, 'success'),
      });
    } else {
      stream.writeSSE({
        data: formateMessage(
          `Error executing command [ ${combinedCommand} ]`,
          taskId,
          'error'
        ),
      });
      throw new Error(`Error executing command [ ${combinedCommand} ]`);
    }
  } catch (error) {
    // * Write the error to client
    if (error instanceof Error) {
      stream.writeSSE({
        data: formateMessage(error.message, taskId, 'error'),
      });
    }
    stream.writeSSE({
      data: formateMessage(
        `Error executing command [ ${combinedCommand} ]`,
        taskId,
        'error'
      ),
    });
  }
}

function formateMessage(
  message: string,
  taskId: string,
  type: 'init' | 'info' | 'error' | 'success' | 'warning' = 'info'
) {
  return JSON.stringify({
    taskId,
    message,
    type,
    timestamp: Date.now(),
  });
}

export default executeCommands;
