import { maybeReconnectUsb2snesAfterEmulatorLaunchViaApi } from './emulator-launch-hooks';

export interface StageTestLaunchStage {
  levelnumber?: string | null;
  levelname: string;
  requisites?: string | null;
  playlevel_patch_code?: string | null;
  difficulty: number;
}

export interface StageTestLaunchContext {
  gameId: string;
  gameVersion?: number | null;
  gameName?: string;
  activeLaunchMethod: 'manual' | 'program' | 'usb2snes';
  getPlaylevelPatchCode: (stage: StageTestLaunchStage) => string;
  getRequisiteTags: (stage: StageTestLaunchStage) => string[];
  formatLevelNumberHex: (levelnumber?: string | null) => string;
  onProgress: (message: string) => void;
}

export interface StageTestLaunchResult {
  success: boolean;
  error?: string;
  playlevelPatchCode?: string;
  appliedPatchCodes?: string[];
  levelHex?: string;
  patchIdentity?: {
    gameid?: string | null;
    gameVersion?: number | null;
    pat_sha224?: string | null;
    pat_sha1?: string | null;
    result_sha1?: string | null;
    result_sha224?: string | null;
    patchdb_template_hashes?: string | null;
  };
}

export async function runStageTestLaunch(
  stage: StageTestLaunchStage,
  ctx: StageTestLaunchContext
): Promise<StageTestLaunchResult> {
  const { onProgress } = ctx;

  if (!stage.levelnumber) {
    return { success: false, error: 'Level number is required to test this level' };
  }

  const api = (window as any)?.electronAPI;
  if (!api?.buildPlusPatchedGame || !api?.getAllExtraPatches) {
    return { success: false, error: 'Test functionality not available' };
  }

  try {
    onProgress('Finding playlevel patch...');
    const patchesResult = await api.getAllExtraPatches();
    if (!patchesResult?.success) {
      return { success: false, error: `Failed to load patches - ${patchesResult?.error || 'Unknown error'}` };
    }

    const allPatches = patchesResult.patches || [];
    const playlevelPatchCode = ctx.getPlaylevelPatchCode(stage);
    const playlevelPatch = allPatches.find((p: any) => p.patch_code === playlevelPatchCode);
    if (!playlevelPatch) {
      return {
        success: false,
        error: `Playlevel patch "${playlevelPatchCode}" not found. Please ensure the patch is defined in the system.`,
      };
    }

    const selectedPatchUuids: string[] = [];
    const requisiteTags = ctx.getRequisiteTags(stage);
    const playlevelInRequisites = requisiteTags.includes(playlevelPatchCode);

    if (!playlevelInRequisites) {
      selectedPatchUuids.push(playlevelPatch.epuuid);
    }

    for (const tag of requisiteTags) {
      const matchingPatch = allPatches.find((p: any) => p.patch_code === tag);
      if (matchingPatch && !selectedPatchUuids.includes(matchingPatch.epuuid)) {
        selectedPatchUuids.push(matchingPatch.epuuid);
      }
    }

    if (playlevelInRequisites && !selectedPatchUuids.includes(playlevelPatch.epuuid)) {
      selectedPatchUuids.push(playlevelPatch.epuuid);
    }

    const appliedPatchCodes = [...requisiteTags];
    if (!appliedPatchCodes.includes(playlevelPatchCode)) {
      appliedPatchCodes.push(playlevelPatchCode);
    }
    appliedPatchCodes.sort();

    onProgress('Loading settings...');
    let currentSettings: any = {};
    if (api.getSettings) {
      const settingsResult = await api.getSettings();
      if (settingsResult && typeof settingsResult === 'object') {
        currentSettings = settingsResult;
      }
    }

    onProgress('Starting build...');
    const levelHex = ctx.formatLevelNumberHex(stage.levelnumber);
    const buildParams = {
      gameId: ctx.gameId,
      gameVersion: ctx.gameVersion || 1,
      selectedPatches: selectedPatchUuids,
      globalParams: {
        glevelnum: levelHex,
        gonoffv: [],
      },
      localParams: {},
      action: 'boot' as const,
      vanillaRomPath: currentSettings.vanillaRomPath || '',
      flipsPath: currentSettings.flipsPath || '',
      asarPath: currentSettings.asarPath || '',
    };

    onProgress(`Building with level number ${levelHex}...`);
    const result = await api.buildPlusPatchedGame(buildParams);
    if (!result?.success) {
      return { success: false, error: `Build failed: ${result?.error || 'Unknown error'}` };
    }

    const patchIdentity = result.patchIdentity || null;

    const launchMethod = ctx.activeLaunchMethod || 'usb2snes';

    if (launchMethod === 'manual') {
      onProgress(`✓ Build complete! Level ${levelHex} - ${stage.levelname}`);
      return { success: true, playlevelPatchCode, appliedPatchCodes, levelHex, patchIdentity: patchIdentity || undefined };
    }

    if (launchMethod === 'program') {
      const launchProgram = currentSettings.launchProgram || '';
      const launchArgs = currentSettings.launchProgramArgs || '%file';
      if (!launchProgram) {
        return { success: false, error: 'No launch program configured in settings' };
      }
      onProgress(`Launching ${result.filename} with program...`);
      try {
        await api.launchProgram(launchProgram, launchArgs, result.outputPath);
        await maybeReconnectUsb2snesAfterEmulatorLaunchViaApi(api, currentSettings);
        if (api.recordCurBooted) {
          await api.recordCurBooted({
            launch_method: 'program',
            launch_mode: 'stage_test',
            gameid: ctx.gameId,
            name: ctx.gameName,
            sfc_basename: result.filename,
            sfc_path: result.outputPath,
            stage: {
              levelnumber: stage.levelnumber,
              levelname: stage.levelname,
              difficulty: stage.difficulty,
            },
          });
        }
        onProgress(`✓ Launched! Level ${levelHex} - ${stage.levelname}`);
        return { success: true, playlevelPatchCode, appliedPatchCodes, levelHex, patchIdentity: patchIdentity || undefined };
      } catch (launchError: any) {
        return { success: false, error: `Launch failed: ${launchError?.message || String(launchError)}` };
      }
    }

    onProgress('Build complete! Connecting to USB2SNES...');
    if (!api.usb2snesConnect || !api.usb2snesUploadRom || !api.usb2snesBoot) {
      onProgress(`✓ Build complete! Level ${levelHex} - ${stage.levelname}`);
      return { success: true, playlevelPatchCode, appliedPatchCodes, levelHex, patchIdentity: patchIdentity || undefined };
    }

    if (currentSettings.usb2snesEnabled !== 'yes') {
      return { success: false, error: 'USB2SNES is not enabled. Please enable it in Settings first.' };
    }

    onProgress('Checking USB2SNES connection...');
    let usb2snesConnected = false;
    try {
      const statusResult = await api.usb2snesStatus?.();
      if (statusResult?.connected) {
        usb2snesConnected = true;
      }
    } catch {
      /* ignore */
    }

    if (!usb2snesConnected) {
      onProgress('Connecting to USB2SNES...');
      try {
        const library = currentSettings.usb2snesLibrary || 'usb2snes_a';
        if (!['usb2snes_a', 'usb2snes_b', 'qusb2snes', 'node-usb'].includes(library)) {
          throw new Error(
            `Invalid USB2SNES library setting: ${library}. Must be one of: usb2snes_a, usb2snes_b, qusb2snes, node-usb`
          );
        }
        const connectOptions: any = {
          library,
          address: currentSettings.usb2snesAddress || 'ws://localhost:64213',
          hostingMethod: currentSettings.usb2snesHostingMethod || 'external',
          proxyMode: currentSettings.usb2snesProxyMode || 'direct',
        };
        if (currentSettings.usb2snesProxyMode === 'socks' && currentSettings.usb2snesSocksProxyUrl) {
          connectOptions.socksProxyUrl = currentSettings.usb2snesSocksProxyUrl;
        }
        if (currentSettings.usb2snesProxyMode === 'ssh' || currentSettings.usb2snesProxyMode === 'direct-with-ssh') {
          connectOptions.ssh = {
            host: currentSettings.usb2snesSshHost,
            username: currentSettings.usb2snesSshUsername,
            localPort: currentSettings.usb2snesSshLocalPort || 64213,
            remotePort: currentSettings.usb2snesSshRemotePort || 64213,
            identityFile: currentSettings.usb2snesSshIdentityFile,
          };
        }
        await api.usb2snesConnect(connectOptions);
        usb2snesConnected = true;
      } catch (connectError: any) {
        return {
          success: false,
          error: `Failed to connect to USB2SNES: ${connectError?.message || String(connectError)}`,
        };
      }
    }

    const filename = result.filename;
    const srcPath = result.outputPath;
    const dstPath = `/work/${filename}`;
    onProgress(`Uploading ${filename} to USB2SNES...`);

    try {
      const removeProgressListener = api.onUploadProgress?.((_t: number, _tot: number, percent: number) => {
        onProgress(`Uploading ${filename}... ${percent}%`);
      });

      const uploadResult = await api.usb2snesUploadRom(srcPath, dstPath);
      if (removeProgressListener) removeProgressListener();

      if (!uploadResult?.success) {
        return { success: false, error: `Upload failed: ${uploadResult?.error || 'Unknown error'}` };
      }

      try {
        if (api.snesContentsSync) {
          await api.snesContentsSync({
            fullpath: dstPath,
            filename,
            gameid: ctx.gameId,
            version: ctx.gameVersion || 1,
            levelnumber: stage.levelnumber || null,
            levelname: stage.levelname || null,
            metadata: { gamename: ctx.gameName || null },
            part_of_a_run: false,
          });
        }
      } catch {
        /* non-fatal */
      }

      try {
        if (api.recordRecentBoot) {
          await api.recordRecentBoot({
            filename,
            fullpath: dstPath,
            gameid: ctx.gameId,
            gamename: ctx.gameName || null,
            levelnumber: stage.levelnumber || null,
            levelname: stage.levelname || null,
          });
        }
      } catch {
        /* non-fatal */
      }

      onProgress(`Upload complete! Booting ${filename}...`);
      try {
        await api.usb2snesBoot(dstPath);
        if (api.recordCurBooted) {
          await api.recordCurBooted({
            launch_method: 'usb2snes',
            launch_mode: 'stage_test',
            gameid: ctx.gameId,
            name: ctx.gameName,
            sfc_basename: filename,
            sfc_path: srcPath,
            stage: {
              levelnumber: stage.levelnumber,
              levelname: stage.levelname,
              difficulty: stage.difficulty,
            },
          });
        }
        onProgress(`✓ Running on SNES! Level ${levelHex} - ${stage.levelname}`);
        return { success: true, playlevelPatchCode, appliedPatchCodes, levelHex, patchIdentity: patchIdentity || undefined };
      } catch (bootError: any) {
        return {
          success: false,
          error: `Uploaded but boot failed: ${bootError?.message || String(bootError)}`,
        };
      }
    } catch (uploadError: any) {
      return { success: false, error: `Upload failed: ${uploadError?.message || String(uploadError)}` };
    }
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
}
