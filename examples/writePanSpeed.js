// kubi.writePanSpeed(degreesPerSecond)
// Write the pan speed. The device starts using it at the next goal write.
export default async function (kubi) {
  await kubi.writePanSpeed(30);
  console.log(kubi.speed.pan.toFixed(2));   // "29.97"
  await kubi.writePanGoal(60);              // turns at about 30°/s
}
