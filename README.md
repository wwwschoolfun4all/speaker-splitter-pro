# Speaker Splitter Pro

Static Web Audio crossover app for splitting one audio source across multiple speaker outputs.

## GitHub Pages

This app can run on GitHub Pages because it has no backend. Use the normal app files in this folder, not the standalone `file://` build.

1. Create a GitHub repository.
2. Upload everything in this `speaker-splitter-pro` folder to the repository root.
3. In GitHub, open `Settings` > `Pages`.
4. Set `Build and deployment` to `Deploy from a branch`.
5. Select the `main` branch and `/ (root)`.
6. Open the Pages URL after GitHub finishes deploying.

## Browser Notes

- Use Chrome or Edge for the best output-device support.
- GitHub Pages uses HTTPS, which is required for many media permissions.
- Some browsers still may not support `selectAudioOutput()` or `AudioContext.setSinkId()`.
- Bluetooth speaker selection depends on browser and operating-system permissions.
