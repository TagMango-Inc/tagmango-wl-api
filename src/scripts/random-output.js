// Function to shuffle an array
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

// Sample messages
const messages = [
  "Downloading packages...",
  "Installing dependencies...",
  "Fetching package metadata...",
  "Resolving package versions...",
  "Linking dependencies...",
  "Compiling TypeScript files...",
  "Optimizing images...",
  "Building JavaScript bundle...",
  "Generating source maps...",
  "Bundling assets...",
  "Preparing environment...",
  "Cleaning up previous build...",
  "Checking for updates...",
  "Verifying package integrity...",
  "Downloading additional resources...",
  "Configuring project settings...",
  "Running pre-build scripts...",
  "Transpiling code...",
  "Optimizing bundle size...",
  "Applying optimizations...",
  "Running post-build tasks...",
  "Packaging application...",
  "Signing packages...",
  "Deploying to device...",
  "Launching application...",
];

const generateRandomInterval = () => {
  return Math.floor(Math.random() * 2000) + 1000; // Random number between 1000ms (1s) and 3000ms (3s)
};
const interval = 1000; // 1 second
const duration = 0.2 * 60 * 1000; // 1 minutes in milliseconds
const endTime = Date.now() + duration;

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Please provide a command-line argument.");
  process.exit(1);
}

const jobId = args[0];

const outputRandomMessage = () => {
  shuffleArray(messages); // Shuffle the array before selecting a random message
  const timeFormat = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(
    `[ ${timeFormat.format(new Date())} ] [ job-${jobId} ] ${messages[0]}`,
  ); // Select the first message after shuffling
};

const intervalId = setInterval(() => {
  const currentTime = Date.now();
  if (currentTime < endTime) {
    outputRandomMessage();
  } else {
    clearInterval(intervalId);
    console.log("Script completed.");
  }
}, interval);
