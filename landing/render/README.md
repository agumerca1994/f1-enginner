# Intro video

The landing's intro is a video rendered from a Three.js scene, so it plays smoothly on any
phone. `scene.js` builds the night corner and the cars (`car3d.js`, the same modern
single-seater as the app's setup viewer, `frontend/components/setup/carModel.ts`). Every
frame is a function of time, so frames rendered at 960 fps are blended into real motion blur.

```sh
cd landing && python3 -m http.server 8090            # serve the folder
npm i playwright-core                                 # once, anywhere on the NODE_PATH
node render/capture.cjs /tmp/h 1920 1080 960 3.6      # landscape frames
node render/capture.cjs /tmp/v 1080 1920 960 3.6      # portrait frames
for o in h v; do
  ffmpeg -framerate 960 -i /tmp/$o/f%05d.jpg -vf "tmix=frames=12,framestep=16,format=yuv420p" \
    -r 60 -c:v libx264 -preset slow -crf 23 -movflags +faststart -an assets/intro/intro-$o.mp4
  ffmpeg -i /tmp/$o/f00000.jpg -vf scale=iw/2:-1 assets/intro/poster-$o.jpg
done
```

`render/carlab.html?c=x,y,z` shows the car alone from a camera position, for modelling.
This folder is not copied into the nginx image.
