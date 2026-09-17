/**
 * 一键出 APK：编译网页 → 同步进安卓工程 → 用 Gradle 打包。
 * 用法：npm run apk
 *
 * 需要 JDK 和安卓 SDK。默认用 D:\android-build-tools 下装好的那套，
 * 如果你装在别处，先设好 JAVA_HOME 和 ANDROID_HOME 环境变量即可。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TOOLCHAIN = 'D:\\android-build-tools';
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || join(TOOLCHAIN, 'jdk'),
  ANDROID_HOME: process.env.ANDROID_HOME || join(TOOLCHAIN, 'sdk')
};

for (const [name, dir] of [['JDK', env.JAVA_HOME], ['安卓 SDK', env.ANDROID_HOME]]) {
  if (!existsSync(dir)) {
    console.error(`找不到${name}：${dir}`);
    console.error('把它装在别处的话，先设置环境变量再跑：');
    console.error(name === 'JDK' ? '  set JAVA_HOME=你的路径' : '  set ANDROID_HOME=你的路径');
    process.exit(1);
  }
}

const isWin = process.platform === 'win32';
const androidDir = join(process.cwd(), 'android');
// 用绝对路径：有些 Windows 环境禁止从当前目录直接找可执行文件
const gradlew = join(androidDir, isWin ? 'gradlew.bat' : 'gradlew');

console.log('开始打包…\n');
const result = isWin
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${gradlew}" assembleRelease`], {
      cwd: androidDir,
      stdio: 'inherit',
      env
    })
  : spawnSync(gradlew, ['assembleRelease'], {
      cwd: androidDir,
      stdio: 'inherit',
      env
    });

if (result.status !== 0) {
  console.error('\n打包失败，往上翻看看报错。');
  process.exit(result.status ?? 1);
}

const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
console.log('\n打包成功。APK 在：');
console.log('  ' + apk);
