// kubi.readBatteryVoltage()
// Read the battery voltage, in millivolts.
export default async function (kubi) {
  const millivolts = await kubi.readBatteryVoltage();
  console.log(millivolts);   // 3700
}
