// kubi.writeTiltGoal(degrees)
// Write the angle the neck tilts to (−20 to 40, positive is upward), give it time, then read where it is.
export default async function (kubi) {
  await kubi.writeTiltGoal(20);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const tilt = await kubi.readTilt();
  console.log(tilt.value.toFixed(1));   // "19.2"
}
