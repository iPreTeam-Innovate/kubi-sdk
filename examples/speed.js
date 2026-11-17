// kubi.speed
// The speed setting of each axis: the last value you wrote (60°/s until you write one). It is not read from the device.
export default async function (kubi) {
  console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "59.94"
  await kubi.writeTiltSpeed(20);
  console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "19.98"
}
