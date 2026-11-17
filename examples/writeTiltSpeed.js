// kubi.writeTiltSpeed(degreesPerSecond)
// Write the tilt speed. The device starts using it at the next goal write.
export default async function (kubi) {
  await kubi.writeTiltSpeed(20);
  console.log(kubi.speed.tilt.toFixed(2));   // "19.98"
  await kubi.writeTiltGoal(30);              // tilts at about 20°/s
}
