# Final fix report
1. returnSerialToStock: UPDATE now requires isNull(deviceId), uses returning; zero rows -> ok:false, changed:false.
2. claimDevice: dup pre-check excludes the claimed row; bind keeps pre-set register (registerNumber ?? existing.registerNumber); name capped at 60 (message passes through claimDeviceAction).
3. Removed `any` in register-number.test.ts.
4. Stale route comments now point at lib/api/trigger-device.ts.
5. CLAUDE.md: index line, register trigger route, device_{n} naming.
6. renameDevice deleted (only docs referenced it).
Verification: vitest 65 files / 654 tests passed; tsc --noEmit clean; eslint on touched files clean.
