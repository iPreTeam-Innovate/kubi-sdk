// kubi.readTilt()
// Read the present tilt position. The device answers one axis per request, so read the two axes one after the other.
export default async function (kubi) {
  const pan = await kubi.readPan();
  const tilt = await kubi.readTilt();
  console.log(pan.value.toFixed(1), tilt.value.toFixed(1));   // "29.2" "19.2"
}
