# Local Pitch Player

![License](https://img.shields.io/badge/License-LGPL_v2.1-blue.svg)
![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=flat&logo=javascript&logoColor=%23F7DF1E)
![Platform](https://img.shields.io/badge/platform-Web-green)
![Status](https://img.shields.io/website?url=https%3A%2F%2Fdreamingzh.github.io%2FLocalPitchPlayer%2F&label=Live%20Demo&up_message=online&up_color=brightgreen)

> 🎧 **Start enjoying music now:** [**https://dreamingzh.github.io/LocalPitchPlayer/**](https://dreamingzh.github.io/LocalPitchPlayer/)

## Overview

**Local Pitch Player** is a lightweight, browser-based audio player designed for audio enthusiasts who require real-time manipulation of audio playback. 

Unlike standard media players, this application processes audio entirely within the client-side browser using the **Web Audio API**. This ensures **complete privacy** and **low-latency performance** without the need to upload files to a remote server.

The core functionality leverages the **SoundTouchJS** library to provide independent control over pitch and tempo. This allows users to:
*   Change the key of a song without affecting its speed.
*   Adjust the playback speed without altering the pitch.

---

## 🚀 Usage

### 🌍 Online Version (Recommended)
You can use the application directly in your browser without any installation. It works on PC, Mac, Android, and iOS.

👉 **[Click here to launch Local Pitch Player](https://dreamingzh.github.io/LocalPitchPlayer/)**

### 💻 Local Development
If you are a developer and wish to modify the code or run it strictly offline:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/DreamingZH/LocalPitchPlayer.git
   ```

2. **Run the application**:
   Simply open the `index.html` file in a modern web browser (Chrome, Firefox, Edge, or Safari).

   > **Note**: Due to browser security policies regarding CORS (Cross-Origin Resource Sharing), some advanced features might require serving the directory via a local HTTP server (e.g., Live Server in VS Code, `python -m http.server`, etc.) rather than opening the file directly via the `file://` protocol.

---

## Key Features

### 🎵 Local File Processing
Supports intuitive **drag-and-drop** functionality for individual audio files or entire directory selection. 

All audio processing occurs **locally** within your browser, ensuring your files remain private.

### 🎛️ Real-Time Audio Manipulation
*   **Pitch Shifting**: Adjust pitch by semitones (**±5 range**), perfect for key transposition to match your instrument.
*   **Tempo Scaling**: Modify playback speed from **0.5x** to **1.5x** without pitch distortion, ideal for slowing down complex passages.

### 🎮 Playback Controls
Includes a full suite of standard transport controls:
*   Play / Pause
*   Previous / Next Track
*   Loop Mode
*   Shuffle / Random Play

### ⌨️ Keyboard Shortcuts
For quicker control, use your keyboard:
*   **Space / Enter**: Toggle Play / Pause
*   **Left Arrow (←)**: Play Previous Track
*   **Right Arrow (→)**: Play Next Track

### 📱 Responsive Design
Features a modern, adaptive user interface that functions seamlessly across:
*   Desktop computers (**Recommended for best experience**)
*   Tablets
*   Mobile smartphones

### 🎨 Theme Support
The interface automatically adapts to your system preferences, supporting both **Light** and **Dark** modes for comfortable viewing in any environment.

### 🌐 Internationalization
Full support for **English** and **Chinese (Simplified)** languages, automatically detected based on browser settings or manually togglable.

---

## Browser Support

This application relies on the modern **Web Audio API**. It is compatible with the latest versions of:

*   ✅ Google Chrome
*   ✅ Mozilla Firefox
*   ✅ Microsoft Edge
*   ✅ Apple Safari (iOS and macOS)

---

## Acknowledgments

This project incorporates the [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) library for high-quality audio time-stretching and pitch-shifting processing.

## License

This project is open-source and available under the [LGPL v2.1 License](LICENSE).
