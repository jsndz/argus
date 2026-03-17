# Argus Video Streaming Application

## Description
Argus is a simple video streaming application built with Express.js. It allows users to upload video files and stream them using RTSP.

## Features
- Upload video files via a web interface.
- Start and stop video streaming.
- Serve static files from the `public` directory.

## Prerequisites
- Node.js (v14 or higher)
- npm (Node Package Manager)

## Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```bash
   cd argus
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Usage
1. Start the server:
   ```bash
   node index.js
   ```
2. Open your browser and navigate to:
   ```
   http://localhost:5000
   ```
3. Use the web interface to:
   - Upload a video file.
   - Start the video stream.
   - Stop the video stream.

## Endpoints
- `POST /upload`: Upload a video file.
- `POST /start-stream`: Start streaming the uploaded video.
- `GET /stop`: Stop the video stream.

## Project Structure
```
argus/
├── index.js          # Main server file
├── package.json      # Project metadata and dependencies
├── public/           # Static files (HTML, CSS, JS)
│   ├── index.html    # Web interface
│   ├── script.js     # Client-side JavaScript
│   ├── style.css     # Stylesheet
└── uploads/          # Directory for uploaded video files
```

## License
This project is licensed under the MIT License.