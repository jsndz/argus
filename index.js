const express = require('express');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

let ffmpegProcess = null;
let filePath = null;

const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    filePath = req.file.path;

    res.send(`File uploaded successfully!`);
});

app.post('/start-stream', (req, res) => {
    if (!filePath) {
        return res.status(400).send('No video uploaded.');
    }

    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
    }

    ffmpegProcess = spawn('ffmpeg', [
        '-re',
        '-stream_loop', '-1',
        '-i', filePath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-c:a', 'aac',
        '-rtsp_transport', 'tcp',
        '-f', 'rtsp',
        'rtsp://localhost:8554/live'
    ]);

    ffmpegProcess.stderr.on('data', (data) => {
        console.log(data.toString());
    });

    const localIp = process.env.LOCAL_IP || 'localhost';
    res.send(`Streaming started! Open http://${localIp}:8889/live`);
});

app.get('/stop', (req, res) => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
    }
    res.send('Streaming stopped!');
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:5000');
});