import { createServer } from 'net';

const port = parseInt(process.argv[2] || '3000', 10);
const server = createServer();

server.on('error', (err) => {
  console.error(`Server error: ${err.message}`);
  process.exit(1);
});

server.on('connection', (socket) => {
  socket.on('data', (data) => {
    // Simple HTTP response
    const response = 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nOK';
    socket.write(response);
  });
});

server.listen(port, () => {
  console.log(`Test server listening on port ${port}`);
});

// Handle graceful shutdown
const shutdown = () => {
  server.close(() => {
    console.log('Test server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);

process.on('SIGINT', shutdown);

// Handle immediate kill (best effort)
process.on('SIGKILL', () => {
  server.close();
  process.exit(0);
});

// Handle server close event (port should be released immediately)
server.on('close', () => {
  console.log('Server closed, port released');
});
