# Speaker Splitter Pro

Static Web Audio crossover app for splitting one audio source across multiple speaker outputs.


## Browser Notes

- Use Chrome or Edge for the best output-device support.
- GitHub Pages uses HTTPS, which is required for many media permissions.
- Some browsers still may not support `selectAudioOutput()` or `AudioContext.setSinkId()`.
- Bluetooth speaker selection depends on browser and operating-system permissions.

## Desktop EXE

The Windows desktop build uses Electron and serves the app from a private local URL inside the app.

```powershell
npm install
npm run build:win
```

The portable executable is written to:

```text
dist\Speaker Splitter Pro.exe
```
