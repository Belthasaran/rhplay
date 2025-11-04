/**
 * IPC Handlers for RHTools Electron App
 * 
 * Handles communication between renderer process (Vue.js) and main process (Node.js)
 * Provides database access, game data, user annotations, and settings
 */

const { ipcMain, dialog, BrowserWindow } = require('electron');
const crypto = require('crypto');
const { app } = require('electron');
const seedManager = require('./seed-manager');
const gameStager = require('./game-stager');
const { matchesFilter } = require('./shared-filter-utils');
const sshManager = require('./main/usb2snes/sshManager');
const usbfxpServer = require('./main/usb2snes/usbfxpServer');

/**
 * Register all IPC handlers with the database manager
 * @param {DatabaseManager} dbManager - Database manager instance
 */
function registerDatabaseHandlers(dbManager) {
  const broadcastUsb2snesSshStatus = (status) => {
    try {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('usb2snes:ssh-status', status);
        }
      });
    } catch (error) {
      console.warn('[USB2SNES][SSH] Failed to broadcast status:', error);
    }
  };

  sshManager.on('status', broadcastUsb2snesSshStatus);
  broadcastUsb2snesSshStatus(sshManager.getStatus());

  const broadcastUsb2snesFxpStatus = (status) => {
    try {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('usb2snes:fxp-status', status);
        }
      });
    } catch (error) {
      console.warn('[USB2SNES][FXP] Failed to broadcast status:', error);
    }
  };

  usbfxpServer.on('status', broadcastUsb2snesFxpStatus);
  broadcastUsb2snesFxpStatus(usbfxpServer.getStatus());
  
  // ===========================================================================
  // GAME DATA OPERATIONS (rhdata.db)
  // ===========================================================================
  
  /**
   * Get all games (latest versions only) with user annotations
   * Channel: db:rhdata:get:games
   */
  ipcMain.handle('db:rhdata:get:games', async () => {
    try {
      return dbManager.withClientData('rhdata', (db) => {
        const games = db.prepare(`
          SELECT 
            gv.gameid as Id,
            gv.name as Name,
            gv.author as Author,
            gv.length as Length,
            gv.combinedtype as Type,
            gv.legacy_type as LegacyType,
            gv.difficulty as PublicDifficulty,
            gv.version as CurrentVersion,
            gv.local_runexcluded as LocalRunExcluded,
            gv.gvjsondata as JsonData,
            COALESCE(uga.status, 'Default') as Status,
            uga.user_difficulty_rating as MyDifficultyRating,
            uga.user_review_rating as MyReviewRating,
            uga.user_skill_rating as MySkillRating,
            uga.user_skill_rating_when_beat as MySkillRatingWhenBeat,
            COALESCE(uga.hidden, 0) as Hidden,
            COALESCE(uga.exclude_from_random, 0) as ExcludeFromRandom,
            uga.user_notes as Mynotes
          FROM gameversions gv
          LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
          WHERE gv.removed = 0
            AND gv.version = (
              SELECT MAX(version) FROM gameversions gv2 
              WHERE gv2.gameid = gv.gameid
            )
          ORDER BY gv.name
        `).all();
        
        // Parse JSON data and convert booleans
        return games.map(g => ({
          ...g,
          JsonData: g.JsonData ? JSON.parse(g.JsonData) : null,
          Hidden: Boolean(g.Hidden),
          ExcludeFromRandom: Boolean(g.ExcludeFromRandom),
          LocalRunExcluded: Boolean(g.LocalRunExcluded),
        }));
      });
    } catch (error) {
      console.error('Error getting games:', error);
      throw error;
    }
  });

  /**
   * Get all available versions for a specific game
   * Channel: db:rhdata:get:versions
   */
  ipcMain.handle('db:rhdata:get:versions', async (event, { gameid }) => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      const versions = db.prepare(`
        SELECT DISTINCT version 
        FROM gameversions 
        WHERE gameid = ?
        ORDER BY version DESC
      `).all(gameid);
      
      return versions.map(v => v.version);
    } catch (error) {
      console.error('Error getting versions:', error);
      throw error;
    }
  });

  /**
   * Get specific game version with annotations
   * Channel: db:rhdata:get:game
   */
  ipcMain.handle('db:rhdata:get:game', async (event, { gameid, version }) => {
    try {
      return dbManager.withClientData('rhdata', (db) => {
        const game = db.prepare(`
          SELECT 
            gv.gameid as Id,
            gv.name as Name,
            gv.author as Author,
            gv.length as Length,
            gv.combinedtype as Type,
            gv.legacy_type as LegacyType,
            gv.difficulty as PublicDifficulty,
            gv.version as CurrentVersion,
            gv.gvjsondata as JsonData,
            gv.demo as Demo,
            gv.contest as Contest,
            gv.racelevel as Racelevel,
            gv.tags as Tags,
            gv.description as Description,
            -- Check for version-specific annotation first, fall back to game-wide
            COALESCE(ugva.status, uga.status, 'Default') as Status,
            COALESCE(ugva.user_difficulty_rating, uga.user_difficulty_rating) as MyDifficultyRating,
            COALESCE(ugva.user_review_rating, uga.user_review_rating) as MyReviewRating,
            COALESCE(ugva.user_skill_rating, uga.user_skill_rating) as MySkillRating,
            COALESCE(ugva.user_skill_rating_when_beat, uga.user_skill_rating_when_beat) as MySkillRatingWhenBeat,
            COALESCE(ugva.user_recommendation_rating, uga.user_recommendation_rating) as MyRecommendationRating,
            COALESCE(ugva.user_importance_rating, uga.user_importance_rating) as MyImportanceRating,
            COALESCE(ugva.user_technical_quality_rating, uga.user_technical_quality_rating) as MyTechnicalQualityRating,
            COALESCE(ugva.user_gameplay_design_rating, uga.user_gameplay_design_rating) as MyGameplayDesignRating,
            COALESCE(ugva.user_originality_rating, uga.user_originality_rating) as MyOriginalityRating,
            COALESCE(ugva.user_visual_aesthetics_rating, uga.user_visual_aesthetics_rating) as MyVisualAestheticsRating,
            COALESCE(ugva.user_story_rating, uga.user_story_rating) as MyStoryRating,
            COALESCE(ugva.user_soundtrack_graphics_rating, uga.user_soundtrack_graphics_rating) as MySoundtrackGraphicsRating,
            COALESCE(ugva.user_review_comment, uga.user_review_comment) as MyReviewComment,
            COALESCE(ugva.user_recommendation_comment, uga.user_recommendation_comment) as MyRecommendationComment,
            COALESCE(ugva.user_importance_comment, uga.user_importance_comment) as MyImportanceComment,
            COALESCE(ugva.user_technical_quality_comment, uga.user_technical_quality_comment) as MyTechnicalQualityComment,
            COALESCE(ugva.user_gameplay_design_comment, uga.user_gameplay_design_comment) as MyGameplayDesignComment,
            COALESCE(ugva.user_originality_comment, uga.user_originality_comment) as MyOriginalityComment,
            COALESCE(ugva.user_visual_aesthetics_comment, uga.user_visual_aesthetics_comment) as MyVisualAestheticsComment,
            COALESCE(ugva.user_story_comment, uga.user_story_comment) as MyStoryComment,
            COALESCE(ugva.user_soundtrack_graphics_comment, uga.user_soundtrack_graphics_comment) as MySoundtrackGraphicsComment,
            COALESCE(uga.hidden, 0) as Hidden,
            COALESCE(uga.exclude_from_random, 0) as ExcludeFromRandom,
            COALESCE(ugva.user_notes, uga.user_notes) as Mynotes,
            -- Flag if this has version-specific annotations
            CASE WHEN ugva.annotation_key IS NOT NULL THEN 1 ELSE 0 END as HasVersionSpecific
          FROM gameversions gv
          LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
          LEFT JOIN clientdata.user_game_version_annotations ugva 
            ON gv.gameid = ugva.gameid AND gv.version = ugva.version
          WHERE gv.gameid = ? AND gv.version = ?
        `).get(gameid, version);
        
        if (!game) return null;
        
        // Parse tags if it's a JSON string
        let tagsParsed = null;
        if (game.Tags) {
          try {
            tagsParsed = JSON.parse(game.Tags);
          } catch (e) {
            // If not JSON, treat as string
            tagsParsed = game.Tags;
          }
        }
        
        return {
          ...game,
          JsonData: game.JsonData ? JSON.parse(game.JsonData) : null,
          Tags: tagsParsed,
          Hidden: Boolean(game.Hidden),
          ExcludeFromRandom: Boolean(game.ExcludeFromRandom),
          HasVersionSpecific: Boolean(game.HasVersionSpecific),
        };
      });
    } catch (error) {
      console.error('Error getting game:', error);
      throw error;
    }
  });

  // ===========================================================================
  // USER ANNOTATION OPERATIONS (clientdata.db)
  // ===========================================================================

  /**
   * Save game annotation (game-wide)
   * Channel: db:clientdata:set:annotation
   */
  ipcMain.handle('db:clientdata:set:annotation', async (event, annotation) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const {
        gameid,
        status,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        hidden,
        excludeFromRandom,
        mynotes,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myReviewComment,
        myRecommendationComment,
        myImportanceComment,
        myTechnicalQualityComment,
        myGameplayDesignComment,
        myOriginalityComment,
        myVisualAestheticsComment,
        myStoryComment,
        mySoundtrackGraphicsComment
      } = annotation;
      
      // Validate inputs
      if (!gameid || typeof gameid !== 'string') {
        throw new Error('Invalid gameid');
      }
      
      if (myDifficultyRating !== null && myDifficultyRating !== undefined) {
        if (myDifficultyRating < 0 || myDifficultyRating > 5) {
          throw new Error('Difficulty rating must be 0-5');
        }
      }
      
      if (myReviewRating !== null && myReviewRating !== undefined) {
        if (myReviewRating < 0 || myReviewRating > 5) {
          throw new Error('Review rating must be 0-5');
        }
      }
      
      if (mySkillRating !== null && mySkillRating !== undefined) {
        if (mySkillRating < 0 || mySkillRating > 10) {
          throw new Error('Skill rating must be 0-10');
        }
      }
      
      if (mySkillRatingWhenBeat !== null && mySkillRatingWhenBeat !== undefined) {
        if (mySkillRatingWhenBeat < 0 || mySkillRatingWhenBeat > 10) {
          throw new Error('Skill rating when beat must be 0-10');
        }
      }
      
      db.prepare(`
        INSERT OR REPLACE INTO user_game_annotations
          (gameid, status, user_difficulty_rating, user_review_rating, user_skill_rating, user_skill_rating_when_beat,
           user_recommendation_rating, user_importance_rating, user_technical_quality_rating,
           user_gameplay_design_rating, user_originality_rating, user_visual_aesthetics_rating,
           user_story_rating, user_soundtrack_graphics_rating,
           user_review_comment, user_recommendation_comment, user_importance_comment,
           user_technical_quality_comment, user_gameplay_design_comment, user_originality_comment,
           user_visual_aesthetics_comment, user_story_comment, user_soundtrack_graphics_comment,
           hidden, exclude_from_random, user_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        gameid,
        status || 'Default',
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myReviewComment || null,
        myRecommendationComment || null,
        myImportanceComment || null,
        myTechnicalQualityComment || null,
        myGameplayDesignComment || null,
        myOriginalityComment || null,
        myVisualAestheticsComment || null,
        myStoryComment || null,
        mySoundtrackGraphicsComment || null,
        hidden ? 1 : 0,
        excludeFromRandom ? 1 : 0,
        mynotes || null
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error saving annotation:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save version-specific annotation
   * Channel: db:clientdata:set:version-annotation
   */
  ipcMain.handle('db:clientdata:set:version-annotation', async (event, annotation) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const {
        gameid,
        version,
        status,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myReviewComment,
        myRecommendationComment,
        myImportanceComment,
        myTechnicalQualityComment,
        myGameplayDesignComment,
        myOriginalityComment,
        myVisualAestheticsComment,
        myStoryComment,
        mySoundtrackGraphicsComment,
        mynotes
      } = annotation;
      
      if (!gameid || version === null || version === undefined) {
        throw new Error('Invalid gameid or version');
      }
      
      const annotationKey = `${gameid}-${version}`;
      
      db.prepare(`
        INSERT OR REPLACE INTO user_game_version_annotations
          (annotation_key, gameid, version, status, 
           user_difficulty_rating, user_review_rating, user_skill_rating, user_skill_rating_when_beat,
           user_recommendation_rating, user_importance_rating, user_technical_quality_rating,
           user_gameplay_design_rating, user_originality_rating, user_visual_aesthetics_rating,
           user_story_rating, user_soundtrack_graphics_rating,
           user_review_comment, user_recommendation_comment, user_importance_comment,
           user_technical_quality_comment, user_gameplay_design_comment, user_originality_comment,
           user_visual_aesthetics_comment, user_story_comment, user_soundtrack_graphics_comment,
           user_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        annotationKey,
        gameid,
        version,
        status,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        mySkillRatingWhenBeat,
        myRecommendationRating,
        myImportanceRating,
        myTechnicalQualityRating,
        myGameplayDesignRating,
        myOriginalityRating,
        myVisualAestheticsRating,
        myStoryRating,
        mySoundtrackGraphicsRating,
        myReviewComment || null,
        myRecommendationComment || null,
        myImportanceComment || null,
        myTechnicalQualityComment || null,
        myGameplayDesignComment || null,
        myOriginalityComment || null,
        myVisualAestheticsComment || null,
        myStoryComment || null,
        mySoundtrackGraphicsComment || null,
        mynotes || null
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error saving version annotation:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // STAGE OPERATIONS (clientdata.db)
  // ===========================================================================

  /**
   * Get stages for a game with user annotations
   * Channel: db:clientdata:get:stages
   */
  ipcMain.handle('db:clientdata:get:stages', async (event, { gameid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const stages = db.prepare(`
        SELECT 
          gs.stage_key as key,
          gs.gameid as parentId,
          gs.exit_number as exitNumber,
          gs.description,
          gs.public_rating as publicRating,
          usa.user_difficulty_rating as myDifficultyRating,
          usa.user_review_rating as myReviewRating,
          usa.user_skill_rating as mySkillRating,
          usa.user_notes as myNotes
        FROM game_stages gs
        LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key
        WHERE gs.gameid = ?
        ORDER BY gs.exit_number
      `).all(gameid);
      
      return stages;
    } catch (error) {
      console.error('Error getting stages:', error);
      return [];
    }
  });

  /**
   * Save stage annotation
   * Channel: db:clientdata:set:stage-annotation
   */
  ipcMain.handle('db:clientdata:set:stage-annotation', async (event, annotation) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const {
        gameid,
        exitNumber,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        myNotes
      } = annotation;
      
      if (!gameid || !exitNumber) {
        throw new Error('Invalid gameid or exitNumber');
      }
      
      const stageKey = `${gameid}-${exitNumber}`;
      
      db.prepare(`
        INSERT OR REPLACE INTO user_stage_annotations
          (stage_key, gameid, exit_number, user_difficulty_rating, 
           user_review_rating, user_skill_rating, user_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        stageKey,
        gameid,
        exitNumber,
        myDifficultyRating,
        myReviewRating,
        mySkillRating,
        myNotes
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error saving stage annotation:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Bulk save stage annotations
   * Channel: db:clientdata:set:stage-annotations-bulk
   */
  ipcMain.handle('db:clientdata:set:stage-annotations-bulk', async (event, { annotations }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const transaction = db.transaction((annotationList) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO user_stage_annotations
            (stage_key, gameid, exit_number, user_difficulty_rating, 
             user_review_rating, user_skill_rating, user_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const ann of annotationList) {
          const stageKey = `${ann.gameid}-${ann.exitNumber}`;
          stmt.run(
            stageKey,
            ann.gameid,
            ann.exitNumber,
            ann.myDifficultyRating,
            ann.myReviewRating,
            ann.mySkillRating,
            ann.myNotes
          );
        }
      });
      
      transaction(annotations);
      
      return { success: true };
    } catch (error) {
      console.error('Error saving stage annotations:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // SETTINGS OPERATIONS (clientdata.db csettings table)
  // ===========================================================================

  /**
   * Get all settings
   * Channel: db:settings:get:all
   */
  ipcMain.handle('db:settings:get:all', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const rows = db.prepare(`
        SELECT csetting_name, csetting_value
        FROM csettings
      `).all();
      
      // Convert to object
      const settings = {};
      rows.forEach(row => {
        settings[row.csetting_name] = row.csetting_value;
      });
      
      return settings;
    } catch (error) {
      console.error('Error getting settings:', error);
      return {};
    }
  });

  /**
   * Set a single setting
   * Channel: db:settings:set:value
   */
  ipcMain.handle('db:settings:set:value', async (event, { name, value }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const uuid = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, name, value);
      
      return { success: true };
    } catch (error) {
      console.error('Error setting value:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save multiple settings at once
   * Channel: db:settings:set:bulk
   */
  ipcMain.handle('db:settings:set:bulk', async (event, { settings }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const transaction = db.transaction((settingsObj) => {
        const stmt = db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `);
        
        Object.entries(settingsObj).forEach(([name, value]) => {
          const uuid = crypto.randomUUID();
          stmt.run(uuid, name, String(value));
        });
      });
      
      transaction(settings);
      
      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // RUN SYSTEM OPERATIONS (clientdata.db)
  // ===========================================================================

  /**
   * Create a new run
   * Channel: db:runs:create
   */
  ipcMain.handle('db:runs:create', async (event, { runName, runDescription, globalConditions }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const runUuid = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO runs (run_uuid, run_name, run_description, status, global_conditions)
        VALUES (?, ?, ?, 'preparing', ?)
      `).run(runUuid, runName, runDescription, JSON.stringify(globalConditions || []));
      
      return { success: true, runUuid };
    } catch (error) {
      console.error('Error creating run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save run plan entries
   * Channel: db:runs:save-plan
   */
  ipcMain.handle('db:runs:save-plan', async (event, { runUuid, entries }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const transaction = db.transaction((runId, entryList) => {
        // Clear existing entries
        db.prepare(`DELETE FROM run_plan_entries WHERE run_uuid = ?`).run(runId);
        
        // Insert new entries
        const stmt = db.prepare(`
          INSERT INTO run_plan_entries
            (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
             count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        entryList.forEach((entry, idx) => {
          const entryUuid = crypto.randomUUID();
          stmt.run(
            entryUuid,
            runId,
            idx + 1,
            entry.entryType,
            entry.id !== '(random)' ? entry.id : null,
            entry.stageNumber || null,
            entry.count || 1,
            entry.filterDifficulty || null,
            entry.filterType || null,
            entry.filterPattern || null,
            entry.seed || null,
            JSON.stringify(entry.conditions || [])
          );
        });
      });
      
      transaction(runUuid, entries);
      
      return { success: true };
    } catch (error) {
      console.error('Error saving run plan:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Start a run (change status to active, expand plan to results)
   * Channel: db:runs:start
   */
  ipcMain.handle('db:runs:start', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Check if run_results exist (from staging)
      const resultsCount = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runUuid);
      
      if (!resultsCount || resultsCount.count === 0) {
        return { success: false, error: 'Run has not been staged yet. Please save and stage the run first.' };
      }
      
      const transaction = db.transaction((runId) => {
        // Cancel any other active runs (only one run can be active at a time)
        db.prepare(`
          UPDATE runs 
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE status = 'active' AND run_uuid != ?
        `).run(runId);
        
        // Update run status to active (run_results already exist from staging)
        db.prepare(`
          UPDATE runs 
          SET status = 'active', 
              started_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE run_uuid = ?
        `).run(runId);
        
        // run_results were already created during staging, just update their timestamps
        db.prepare(`
          UPDATE run_results
          SET started_at = CURRENT_TIMESTAMP
          WHERE run_uuid = ? AND status = 'pending'
        `).run(runId);
        
        // Update total challenges count (should already be set, but update to be sure)
        const total = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runId);
        db.prepare(`UPDATE runs SET total_challenges = ? WHERE run_uuid = ?`).run(total.count, runId);
        
        console.log(`Started run with ${total.count} challenges`);
      });
      
      try {
        transaction(runUuid);
        console.log('Transaction completed successfully');
      } catch (transactionError) {
        console.error('Transaction failed:', transactionError);
        throw transactionError;
      }
      
      // Verify results were inserted
      const verifyCount = db.prepare(`SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?`).get(runUuid);
      console.log('Verification: run_results count =', verifyCount.count);
      
      if (verifyCount.count === 0) {
        throw new Error('Failed to create run results - no entries inserted');
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error starting run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Record challenge result
   * Channel: db:runs:record-result
   */
  ipcMain.handle('db:runs:record-result', async (event, { runUuid, challengeIndex, status }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get the result at this index
      const result = db.prepare(`
        SELECT result_uuid FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number 
        LIMIT 1 OFFSET ?
      `).get(runUuid, challengeIndex);
      
      if (!result) {
        throw new Error('Challenge not found');
      }
      
      // Update result
      db.prepare(`
        UPDATE run_results
        SET status = ?,
            completed_at = CURRENT_TIMESTAMP,
            duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
        WHERE result_uuid = ?
      `).run(status, result.result_uuid);
      
      // Update run counts
      if (status === 'success' || status === 'ok') {
        db.prepare(`
          UPDATE runs 
          SET completed_challenges = completed_challenges + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE run_uuid = ?
        `).run(runUuid);
      } else if (status === 'skipped') {
        db.prepare(`
          UPDATE runs 
          SET skipped_challenges = skipped_challenges + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE run_uuid = ?
        `).run(runUuid);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error recording challenge result:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cancel a run
   * Channel: db:runs:cancel
   */
  ipcMain.handle('db:runs:cancel', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      db.prepare(`
        UPDATE runs 
        SET status = 'cancelled',
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_uuid = ?
      `).run(runUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error cancelling run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Complete a run (mark as finished)
   * Channel: db:runs:complete
   */
  ipcMain.handle('db:runs:complete', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Update run status to completed
      db.prepare(`
        UPDATE runs 
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_uuid = ?
      `).run(runUuid);
      
      console.log(`Run ${runUuid} marked as completed`);
      return { success: true };
    } catch (error) {
      console.error('Error completing run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get run results (expanded challenges)
   * Channel: db:runs:get-results
   */
  ipcMain.handle('db:runs:get-results', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const results = db.prepare(`
        SELECT 
          result_uuid,
          run_uuid,
          plan_entry_uuid,
          sequence_number,
          gameid,
          game_name,
          exit_number,
          stage_description,
          was_random,
          revealed_early,
          status,
          started_at,
          completed_at,
          duration_seconds,
          conditions,
          sfcpath
        FROM run_results
        WHERE run_uuid = ?
        ORDER BY sequence_number
      `).all(runUuid);
      
      return results;
    } catch (error) {
      console.error('Error getting run results:', error);
      throw error;
    }
  });

  /**
   * Get active run (for startup check)
   * Channel: db:runs:get-active
   */
  ipcMain.handle('db:runs:get-active', async (event) => {
    try {
      const activeRun = gameStager.getActiveRun(dbManager);
      
      if (!activeRun) {
        return null;
      }
      
      // Calculate elapsed time
      const elapsedSeconds = gameStager.calculateRunElapsed(activeRun);
      const isPaused = gameStager.isRunPaused(activeRun);
      
      return {
        ...activeRun,
        elapsedSeconds,
        isPaused
      };
    } catch (error) {
      console.error('Error getting active run:', error);
      return null;
    }
  });

  /**
   * Pause a run
   * Channel: db:runs:pause
   */
  ipcMain.handle('db:runs:pause', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Set pause_start for run
      db.prepare(`
        UPDATE runs
        SET pause_start = CURRENT_TIMESTAMP,
            pause_end = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_uuid = ? AND status = 'active'
      `).run(runUuid);
      
      // Get current challenge index and set pause_start for it
      const currentResult = db.prepare(`
        SELECT result_uuid FROM run_results
        WHERE run_uuid = ? AND status = 'pending'
        ORDER BY sequence_number
        LIMIT 1
      `).get(runUuid);
      
      if (currentResult) {
        db.prepare(`
          UPDATE run_results
          SET pause_start = CURRENT_TIMESTAMP,
              pause_end = NULL
          WHERE result_uuid = ?
        `).run(currentResult.result_uuid);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error pausing run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Unpause a run
   * Channel: db:runs:unpause
   */
  ipcMain.handle('db:runs:unpause', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Calculate pause duration for run
      const run = db.prepare(`SELECT pause_start, pause_seconds FROM runs WHERE run_uuid = ?`).get(runUuid);
      
      if (run && run.pause_start) {
        const pauseStart = new Date(run.pause_start).getTime();
        const pauseDuration = Math.floor((Date.now() - pauseStart) / 1000);
        const totalPaused = (run.pause_seconds || 0) + pauseDuration;
        
        // Update run
        db.prepare(`
          UPDATE runs
          SET pause_seconds = ?,
              pause_start = NULL,
              pause_end = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE run_uuid = ?
        `).run(totalPaused, runUuid);
      }
      
      // Calculate pause duration for current challenge
      const currentResult = db.prepare(`
        SELECT result_uuid, pause_start, pause_seconds 
        FROM run_results
        WHERE run_uuid = ? AND status = 'pending'
        ORDER BY sequence_number
        LIMIT 1
      `).get(runUuid);
      
      if (currentResult && currentResult.pause_start) {
        const pauseStart = new Date(currentResult.pause_start).getTime();
        const pauseDuration = Math.floor((Date.now() - pauseStart) / 1000);
        const totalPaused = (currentResult.pause_seconds || 0) + pauseDuration;
        
        db.prepare(`
          UPDATE run_results
          SET pause_seconds = ?,
              pause_start = NULL,
              pause_end = CURRENT_TIMESTAMP
          WHERE result_uuid = ?
        `).run(totalPaused, currentResult.result_uuid);
      }
      
      // Get updated pause_seconds to return
      const updatedRun = db.prepare(`SELECT pause_seconds FROM runs WHERE run_uuid = ?`).get(runUuid);
      
      return { success: true, pauseSeconds: updatedRun ? updatedRun.pause_seconds : 0 };
    } catch (error) {
      console.error('Error unpausing run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get unique filter values for random game selection
   * Channel: db:get-random-filter-values
   */
  ipcMain.handle('db:get-random-filter-values', async () => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      // Get unique difficulties
      const difficulties = db.prepare(`
        SELECT DISTINCT difficulty 
        FROM gameversions 
        WHERE difficulty IS NOT NULL AND difficulty != '' AND removed = 0
        ORDER BY difficulty
      `).all().map(row => row.difficulty);
      
      // Get unique types from both gametype and legacy_type
      const types = db.prepare(`
        SELECT DISTINCT gametype AS type
        FROM gameversions
        WHERE gametype IS NOT NULL AND gametype != '' AND removed = 0
        UNION
        SELECT DISTINCT legacy_type AS type
        FROM gameversions
        WHERE legacy_type IS NOT NULL AND legacy_type != '' AND removed = 0
        ORDER BY type
      `).all().map(row => row.type);
      
      return { success: true, difficulties, types };
    } catch (error) {
      console.error('Error getting filter values:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Count games matching random filter criteria
   * Channel: db:count-random-matches
   */
  ipcMain.handle('db:count-random-matches', async (event, { filterType, filterDifficulty, filterPattern }) => {
    try {
      const db = dbManager.getConnection('rhdata');
      
      // First get all games with basic filters (type and difficulty)
      let query = `
        SELECT gv.gameid, gv.version, gv.name, gv.combinedtype, gv.difficulty, gv.gametype, gv.legacy_type, gv.author, gv.length, gv.description, gv.demo, gv.featured, gv.obsoleted, gv.removed, gv.moderated, gvs.rating_value
        FROM gameversions gv
        LEFT JOIN gameversion_stats gvs ON gv.gameid = gvs.gameid
        WHERE gv.removed = 0 AND gv.obsoleted = 0
      `;
      const queryParams = [];
      
      // Apply type filter (matches either gametype OR legacy_type)
      if (filterType && filterType !== '' && filterType !== 'any') {
        query += ` AND (gv.gametype = ? OR gv.legacy_type = ?)`;
        queryParams.push(filterType, filterType);
      }
      
      // Apply difficulty filter
      if (filterDifficulty && filterDifficulty !== '' && filterDifficulty !== 'any') {
        query += ` AND gv.difficulty = ?`;
        queryParams.push(filterDifficulty);
      }
      
      const games = db.prepare(query).all(...queryParams);
      
      // Apply advanced pattern filter using shared filter logic
      const filteredGames = filterPattern && filterPattern !== '' 
        ? games.filter(game => matchesFilter(game, filterPattern))
        : games;
      
      return { success: true, count: filteredGames.length };
    } catch (error) {
      console.error('Error counting random matches:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Expand run plan and prepare for staging (select & reveal all random games)
   * Channel: db:runs:expand-and-prepare
   */
  ipcMain.handle('db:runs:expand-and-prepare', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const transaction = db.transaction((runId) => {
        // Clean up any existing run_results (in case of re-staging)
        db.prepare(`DELETE FROM run_results WHERE run_uuid = ?`).run(runId);
        
        // Get plan entries
        const planEntries = db.prepare(`
          SELECT * FROM run_plan_entries 
          WHERE run_uuid = ? 
          ORDER BY sequence_number
        `).all(runId);
        
        // Expand plan entries to run_results
        const insertStmt = db.prepare(`
          INSERT INTO run_results
            (result_uuid, run_uuid, plan_entry_uuid, sequence_number, 
             gameid, game_name, exit_number, stage_description,
             was_random, revealed_early, status, conditions)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `);
        
        let resultSequence = 1;
        const usedGameids = [];
        
        planEntries.forEach((planEntry) => {
          const count = planEntry.count || 1;
          const isRandom = planEntry.entry_type === 'random_game' || planEntry.entry_type === 'random_stage';
          
          // Create multiple results if count > 1
          for (let i = 0; i < count; i++) {
            const resultUuid = crypto.randomUUID();
            let gameName = '???';
            let gameid = null;
            let exitNumber = planEntry.exit_number;
            let stageDescription = null;
            
            if (isRandom) {
              // Select random game and REVEAL it immediately (for staging)
              try {
                const selected = seedManager.selectRandomGame({
                  dbManager,
                  seed: planEntry.filter_seed,
                  challengeIndex: resultSequence,
                  filterType: planEntry.filter_type,
                  filterDifficulty: planEntry.filter_difficulty,
                  filterPattern: planEntry.filter_pattern,
                  excludeGameids: usedGameids
                });
                
                // Store the ACTUAL game data in database (UI will mask it based on was_random flag)
                gameid = selected.gameid;
                gameName = selected.name;  // Store actual name, UI will mask it
                exitNumber = selected.exit_number;
                stageDescription = selected.stageName || null;
                usedGameids.push(selected.gameid);
                
              } catch (error) {
                console.error('Error selecting random game:', error);
                throw error;  // Fail staging if we can't select a game
              }
            } else {
              // For specific entries, use the gameid from plan
              gameid = planEntry.gameid;
              exitNumber = planEntry.exit_number;
              usedGameids.push(gameid);
              
              // Fetch game name
              const rhdb = dbManager.getConnection('rhdata');
              const game = rhdb.prepare(`
                SELECT name FROM gameversions 
                WHERE gameid = ? AND version = (
                  SELECT MAX(version) FROM gameversions WHERE gameid = ?
                )
              `).get(gameid, gameid);
              
              gameName = game ? game.name : 'Unknown';
              
              // Fetch stage description if exit specified
              if (exitNumber) {
                const exitInfo = rhdb.prepare(`
                  SELECT description FROM exits 
                  WHERE gameid = ? AND exit_number = ?
                `).get(gameid, exitNumber);
                stageDescription = exitInfo ? exitInfo.description : null;
              }
            }
            
            // Insert result
            insertStmt.run(
              resultUuid,
              runId,
              planEntry.entry_uuid,
              resultSequence,
              gameid,
              gameName,
              exitNumber,
              stageDescription,
              isRandom ? 1 : 0,
              0,  // revealed_early: false (not revealed yet)
              JSON.stringify(planEntry.conditions || [])
            );
            
            resultSequence++;
          }
        });
        
        console.log(`Expanded ${planEntries.length} plan entries to ${resultSequence - 1} results`);
      });
      
      transaction(runUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error expanding run plan:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Stage run games (create SFC files)
   * Channel: db:runs:stage-games
   */
  ipcMain.handle('db:runs:stage-games', async (event, { runUuid, vanillaRomPath, flipsPath }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const userDataPath = app.getPath('userData');
      
      // Fetch run_results (already expanded with all games revealed)
      const expandedResults = db.prepare(`
        SELECT 
          result_uuid,
          run_uuid,
          plan_entry_uuid,
          sequence_number,
          gameid,
          game_name,
          exit_number,
          stage_description,
          was_random,
          status,
          conditions
        FROM run_results
        WHERE run_uuid = ?
        ORDER BY sequence_number
      `).all(runUuid);
      
      if (expandedResults.length === 0) {
        return { success: false, error: 'No games found in run results. Please expand run plan first.' };
      }
      
      const result = await gameStager.stageRunGames({
        dbManager,
        runUuid,
        expandedResults,
        userDataPath,
        vanillaRomPath,
        flipsPath,
        onProgress: (current, total, gameName) => {
          // Send progress updates to renderer
          event.sender.send('staging-progress', { current, total, gameName });
        }
      });
      
      return result;
    } catch (error) {
      console.error('Error staging games:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Stage games for quick launch (direct launch without creating a run)
   * Channel: db:games:quick-launch-stage
   */
  ipcMain.handle('db:games:quick-launch-stage', async (event, { gameIds, vanillaRomPath, flipsPath, tempDirOverride }) => {
    try {
      const result = await gameStager.stageQuickLaunchGames({
        dbManager,
        gameIds,
        vanillaRomPath,
        flipsPath,
        tempDirOverride,
        onProgress: (current, total, gameName) => {
          // Send progress updates to renderer
          event.sender.send('quick-launch-progress', { current, total, gameName });
        }
      });
      
      return result;
    } catch (error) {
      console.error('Error staging games for quick launch:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Upload run files to USB2SNES subdirectory
   * Channel: db:runs:upload-to-snes
   */
  ipcMain.handle('db:runs:upload-to-snes', async (event, { runUuid, runFolderPath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const db = dbManager.getConnection('clientdata');
      
      // Get run info
      const run = db.prepare(`SELECT run_name FROM runs WHERE run_uuid = ?`).get(runUuid);
      if (!run) {
        return { success: false, error: 'Run not found' };
      }
      
      // Generate subdirectory name: runYYMMDD_HHMM
      const now = new Date();
      const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');  // YYMMDD
      const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');  // HHMM
      const subDirName = `run${dateStr}_${timeStr}`;
      const snesPath = `/work/${subDirName}`;
      
      // Get USB2SNES wrapper
      const wrapper = getSnesWrapper();
      
      console.log('[Upload Run] Wrapper:', !!wrapper);
      console.log('[Upload Run] isAttached:', wrapper ? wrapper.isAttached() : 'N/A');
      console.log('[Upload Run] getState:', wrapper ? wrapper.getState() : 'N/A');
      console.log('[Upload Run] hasImplementation:', wrapper ? wrapper.hasImplementation() : 'N/A');
      
      // Check connection status
      if (!wrapper || !wrapper.isAttached()) {
        return { success: false, error: `USB2SNES not connected. State: ${wrapper ? wrapper.getState() : 'no wrapper'}, Attached: ${wrapper ? wrapper.isAttached() : 'N/A'}` };
      }
      
      // Create the run subdirectory ONCE before uploading files
      // First check if it already exists by listing parent directory
      console.log(`[Upload Run] Checking if directory exists: ${snesPath}`);
      try {
        const workListing = await wrapper.List('/work');
        const dirExists = workListing && workListing.some(item => 
          item.type === 1 && item.filename === subDirName
        );
        
        if (dirExists) {
          console.log(`[Upload Run] Directory already exists: ${snesPath}`);
          // Add to cache even if it already exists
          if (wrapper.implementationInstance && wrapper.implementationInstance.createdDirectories) {
            wrapper.implementationInstance.createdDirectories.add(snesPath);
            console.log(`[Upload Run] Added existing directory to cache: ${snesPath}`);
          }
        } else {
          console.log(`[Upload Run] Creating directory: ${snesPath}`);
          
          // Access _mkdir through the implementation
          if (!wrapper.implementationInstance || !wrapper.implementationInstance._mkdir) {
            return { success: false, error: 'USB2SNES implementation not available' };
          }
          
          await wrapper.implementationInstance._mkdir(snesPath);
          console.log(`[Upload Run] Directory creation command sent`);
          
          // Wait a bit for the command to process
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Check if connection survived
          if (!wrapper.isAttached()) {
            return { success: false, error: `Failed to create directory ${snesPath} - server closed connection` };
          }
          
          console.log(`[Upload Run] Directory created: ${snesPath}`);
        }
      } catch (dirError) {
        console.error(`[Upload Run] Directory setup failed:`, dirError);
        return { success: false, error: `Cannot prepare directory: ${dirError.message}` };
      }
      
      // Get list of SFC files to upload
      const files = fs.readdirSync(runFolderPath).filter(f => f.endsWith('.sfc')).sort();
      
      if (files.length === 0) {
        return { success: false, error: 'No .sfc files found in run folder' };
      }
      
      // Add directory to cache so preemptiveDirCreate skips it (even after reconnects)
      if (wrapper.implementationInstance && wrapper.implementationInstance.createdDirectories) {
        wrapper.implementationInstance.createdDirectories.add(snesPath);
        console.log(`[Upload Run] Added ${snesPath} to directory cache`);
      }
      
      console.log(`[Upload Run] Uploading ${files.length} files to ${snesPath}`);
      
      // Upload each file with progress tracking
      let uploadedCount = 0;
      for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const srcPath = path.join(runFolderPath, filename);
        const dstPath = `${snesPath}/${filename}`;
        
        console.log(`[Upload Run] Uploading ${i + 1}/${files.length}: ${filename}`);
        console.log(`[Upload Run]   Source: ${srcPath}`);
        console.log(`[Upload Run]   Destination: ${dstPath}`);
        event.sender.send('run-upload-progress', { current: i + 1, total: files.length, filename });
        
        // Check connection before each upload
        if (!wrapper.isAttached()) {
          console.warn(`[Upload Run]   Connection lost before file ${i + 1}, attempting reconnect...`);
          
          // Try to reconnect
          try {
            const library = wrapper.getImplementationType() || 'usb2snes_a';
            const address = 'ws://localhost:64213';
            await wrapper.fullConnect(library, address);
            console.log(`[Upload Run]   ✓ Reconnected successfully`);
            
            // After reconnect, re-add directory to cache to prevent re-creation attempts
            if (wrapper.implementationInstance && wrapper.implementationInstance.createdDirectories) {
              wrapper.implementationInstance.createdDirectories.add(snesPath);
              console.log(`[Upload Run]   Re-added ${snesPath} to directory cache after reconnect`);
            }
          } catch (reconnectError) {
            console.error(`[Upload Run]   ✗ Reconnect failed:`, reconnectError);
            return {
              success: false,
              error: `Connection lost before file ${i + 1}/${files.length} and reconnect failed. Uploaded ${uploadedCount}/${files.length} files.`,
              filesUploaded: uploadedCount
            };
          }
        }
        
        try {
          const uploadResult = await wrapper.PutFile(srcPath, dstPath);
          console.log(`[Upload Run]   Result:`, uploadResult);
          
          if (uploadResult === false || uploadResult === null) {
            // Upload failed, connection might be lost
            console.error(`[Upload Run]   Upload returned false/null for ${filename}`);
            return { 
              success: false, 
              error: `Upload failed at file ${i + 1}/${files.length}: ${filename}. PutFile returned ${uploadResult}.`,
              filesUploaded: uploadedCount
            };
          }
          
          console.log(`[Upload Run]   ✓ Upload successful for ${filename}`);
          uploadedCount++;
        } catch (uploadError) {
          console.error(`[Upload Run]   Upload threw error for ${filename}:`, uploadError);
          return {
            success: false,
            error: `Upload error at file ${i + 1}/${files.length}: ${filename}. ${uploadError.message}`,
            filesUploaded: uploadedCount
          };
        }
      }
      
      // Update run_results with sfcpath (relative path for each game)
      const expandedResults = db.prepare(`
        SELECT result_uuid, sequence_number FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number
      `).all(runUuid);
      
      const updateStmt = db.prepare(`UPDATE run_results SET sfcpath = ? WHERE result_uuid = ?`);
      expandedResults.forEach((result, idx) => {
        if (idx < files.length) {
          const sfcpath = `${subDirName}/${files[idx]}`;
          updateStmt.run(sfcpath, result.result_uuid);
        }
      });
      
      console.log(`[Upload Run] Upload complete: ${uploadedCount} files to ${snesPath}`);
      
      return { 
        success: true, 
        filesUploaded: uploadedCount,
        snesPath: snesPath
      };
    } catch (error) {
      console.error('[Upload Run] Error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Reveal a random challenge (select and update with actual game)
   * Channel: db:runs:reveal-challenge
   */
  ipcMain.handle('db:runs:reveal-challenge', async (event, { runUuid, resultUuid, revealedEarly }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get the result and its plan entry
      const result = db.prepare(`
        SELECT rr.*, rpe.filter_type, rpe.filter_difficulty, rpe.filter_pattern, rpe.filter_seed
        FROM run_results rr
        JOIN run_plan_entries rpe ON rr.plan_entry_uuid = rpe.entry_uuid
        WHERE rr.result_uuid = ?
      `).get(resultUuid);
      
      if (!result) {
        throw new Error('Challenge not found');
      }
      
      if (!result.was_random) {
        // Not a random challenge, nothing to reveal
        return { 
          success: true, 
          gameid: result.gameid, 
          gameName: result.game_name 
        };
      }
      
      if (result.gameid) {
        // Already revealed
        return { 
          success: true, 
          gameid: result.gameid, 
          gameName: result.game_name,
          alreadyRevealed: true
        };
      }
      
      // Get already used gameids in this run to avoid duplicates
      const usedGames = db.prepare(`
        SELECT gameid FROM run_results 
        WHERE run_uuid = ? AND gameid IS NOT NULL
      `).all(runUuid).map(r => r.gameid);
      
      // Select random game
      const selected = seedManager.selectRandomGame({
        dbManager,
        seed: result.filter_seed,
        challengeIndex: result.sequence_number,
        filterType: result.filter_type,
        filterDifficulty: result.filter_difficulty,
        filterPattern: result.filter_pattern,
        excludeGameids: usedGames
      });
      
      // Update run_results with selected game
      db.prepare(`
        UPDATE run_results
        SET gameid = ?,
            game_name = ?,
            revealed_early = ?,
            started_at = CURRENT_TIMESTAMP
        WHERE result_uuid = ?
      `).run(selected.gameid, selected.name, revealedEarly ? 1 : 0, resultUuid);
      
      console.log(`Revealed random challenge: ${selected.name} (${selected.gameid}), early=${revealedEarly}`);
      
      return { 
        success: true, 
        gameid: selected.gameid, 
        gameName: selected.name,
        gameType: selected.type,
        gameDifficulty: selected.difficulty
      };
    } catch (error) {
      console.error('Error revealing challenge:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Mark a challenge as revealed early (after using Back button)
   * Channel: db:runs:mark-revealed-early
   */
  ipcMain.handle('db:runs:mark-revealed-early', async (event, { runUuid, challengeIndex, revealedEarly }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Get the result at this index
      const result = db.prepare(`
        SELECT result_uuid FROM run_results 
        WHERE run_uuid = ? 
        ORDER BY sequence_number 
        LIMIT 1 OFFSET ?
      `).get(runUuid, challengeIndex);
      
      if (!result) {
        throw new Error('Challenge not found at index ' + challengeIndex);
      }
      
      // Update revealed_early flag
      db.prepare(`
        UPDATE run_results
        SET revealed_early = ?
        WHERE result_uuid = ?
      `).run(revealedEarly ? 1 : 0, result.result_uuid);
      
      console.log(`Marked challenge ${challengeIndex + 1} as revealed_early=${revealedEarly}`);
      
      return { success: true };
    } catch (error) {
      console.error('Error marking challenge as revealed early:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // SEED MANAGEMENT OPERATIONS
  // ===========================================================================

  /**
   * Generate a new random seed with default mapping
   * Channel: db:seeds:generate
   */
  ipcMain.handle('db:seeds:generate', async (event) => {
    try {
      const defaultMapping = seedManager.getOrCreateDefaultMapping(dbManager);
      const seed = seedManager.generateSeedWithMap(defaultMapping.mapId);
      
      return { 
        success: true, 
        seed,
        mapId: defaultMapping.mapId,
        gameCount: defaultMapping.gameCount
      };
    } catch (error) {
      console.error('Error generating seed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get all available seed mappings
   * Channel: db:seeds:get-mappings
   */
  ipcMain.handle('db:seeds:get-mappings', async (event) => {
    try {
      const mappings = seedManager.getAllSeedMappings(dbManager);
      return mappings;
    } catch (error) {
      console.error('Error getting mappings:', error);
      throw error;
    }
  });

  /**
   * Validate a seed
   * Channel: db:seeds:validate
   */
  ipcMain.handle('db:seeds:validate', async (event, { seed }) => {
    try {
      const isValid = seedManager.validateSeed(dbManager, seed);
      
      if (isValid) {
        const { mapId } = seedManager.parseSeed(seed);
        const mapping = seedManager.getSeedMapping(dbManager, mapId);
        return { 
          valid: true, 
          mapId,
          gameCount: mapping ? mapping.gameCount : 0
        };
      }
      
      return { valid: false };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  });

  /**
   * Export run with seed mappings
   * Channel: db:runs:export
   */
  ipcMain.handle('db:runs:export', async (event, { runUuid }) => {
    try {
      const exportData = seedManager.exportRun(dbManager, runUuid);
      return { success: true, data: exportData };
    } catch (error) {
      console.error('Error exporting run:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import run with seed mappings
   * Channel: db:runs:import
   */
  ipcMain.handle('db:runs:import', async (event, { importData }) => {
    try {
      const result = seedManager.importRun(dbManager, importData);
      return result;
    } catch (error) {
      console.error('Error importing run:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // Shell Operations
  // ===========================================================================

  /**
   * Open a folder or file in the system's default file manager/application
   * Channel: shell:open-path
   */
  ipcMain.handle('shell:open-path', async (event, path) => {
    try {
      const { shell } = require('electron');
      await shell.openPath(path);
      return { success: true };
    } catch (error) {
      console.error('Error opening path:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // File Selection and Validation
  // ===========================================================================

  /**
   * Open file selection dialog
   * Channel: file:select
   */
  ipcMain.handle('file:select', async (event, options) => {
    console.log('[file:select] Handler called with options:', options);
    try {
      const { dialog, BrowserWindow } = require('electron');
      const win = BrowserWindow.fromWebContents(event.sender);
      
      console.log('[file:select] Showing dialog...');
      
      // Try with no parent first (for Linux compatibility)
      let result = await dialog.showOpenDialog(options);
      
      // If that didn't work and we have a window, try with parent
      if (!result || (result.canceled && result.filePaths.length === 0)) {
        console.log('[file:select] First attempt got no result, trying with parent window...');
        if (win) {
          result = await dialog.showOpenDialog(win, options);
        }
      }
      
      console.log('[file:select] Dialog result:', result);
      
      if (!result || result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      
      return { success: true, filePath: result.filePaths[0] };
    } catch (error) {
      console.error('[file:select] Error selecting file:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Validate ROM file (SHA-224 hash check)
   * Channel: file:validate-rom
   */
  ipcMain.handle('file:validate-rom', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const crypto = require('crypto');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Expected SHA-224 hash for valid SMW ROM
      const EXPECTED_SHA224 = 'fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08';
      
      // Calculate SHA-224 hash
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha224').update(fileBuffer).digest('hex');
      
      if (hash === EXPECTED_SHA224) {
        return { valid: true, hash, filePath };
      } else {
        return { valid: false, error: `Invalid ROM hash. Expected: ${EXPECTED_SHA224}, Got: ${hash}` };
      }
    } catch (error) {
      console.error('Error validating ROM:', error);
      return { valid: false, error: error.message };
    }
  });

  /**
   * Validate FLIPS executable
   * Channel: file:validate-flips
   */
  ipcMain.handle('file:validate-flips', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Check if file is executable (Unix) or has .exe extension (Windows)
      const stats = fs.statSync(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0 || path.extname(filePath).toLowerCase() === '.exe';
      
      if (!isExecutable) {
        return { valid: false, error: 'File is not executable' };
      }
      
      // Basic validation - check if file exists and is executable
      // More advanced validation would require actually running it
      return { valid: true, filePath };
    } catch (error) {
      console.error('Error validating FLIPS:', error);
      return { valid: false, error: error.message };
    }
  });

  /**
   * Validate directory path
   * Channel: file:validate-path
   */
  ipcMain.handle('file:validate-path', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      
      if (!fs.existsSync(filePath)) {
        return { exists: false, isDirectory: false, error: 'Path not found' };
      }
      
      const stats = fs.statSync(filePath);
      return { exists: true, isDirectory: stats.isDirectory(), filePath };
    } catch (error) {
      console.error('Error validating path:', error);
      return { exists: false, isDirectory: false, error: error.message };
    }
  });

  /**
   * Validate ASAR executable
   * Channel: file:validate-asar
   */
  ipcMain.handle('file:validate-asar', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Check if file is executable
      const stats = fs.statSync(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0 || path.extname(filePath).toLowerCase() === '.exe';
      
      if (!isExecutable) {
        return { valid: false, error: 'File is not executable' };
      }
      
      return { valid: true, filePath };
    } catch (error) {
      console.error('Error validating ASAR:', error);
      return { valid: false, error: error.message };
    }
  });

  /**
   * Validate UberASM executable
   * Channel: file:validate-uberasm
   */
  ipcMain.handle('file:validate-uberasm', async (event, { filePath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }
      
      // Check if file is executable
      const stats = fs.statSync(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0 || path.extname(filePath).toLowerCase() === '.exe';
      
      if (!isExecutable) {
        return { valid: false, error: 'File is not executable' };
      }
      
      return { valid: true, filePath };
    } catch (error) {
      console.error('Error validating UberASM:', error);
      return { valid: false, error: error.message };
    }
  });

  // ===========================================================================
  // USB2SNES OPERATIONS
  // ===========================================================================

  const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');
  
  // Global SNES wrapper instance (singleton pattern)
  let snesWrapper = null;
  
  /**
   * Get or create SNES wrapper instance
   * @private
   */
  function getSnesWrapper() {
    if (!snesWrapper) {
      snesWrapper = new SNESWrapper();
    }
    return snesWrapper;
  }

  /**
   * Connect to USB2SNES server
   * Channel: usb2snes:connect
   * @param {Object} options - Connection options (library, address, proxy)
   * @returns {Object} Connection info (device, firmware, etc.)
   */
  ipcMain.handle('usb2snes:connect', async (event, options = {}) => {
    try {
      const { library, proxyMode } = options;
      if (!library) {
        throw new Error('USB2SNES library not specified.');
      }

      if (proxyMode === 'ssh') {
        const sshStatus = sshManager.getStatus();
        if (!sshStatus.running) {
          throw new Error('SSH client is not running. Start the SSH client before connecting.');
        }
      }

      const wrapper = getSnesWrapper();
      const result = await wrapper.fullConnect(library, options);

      console.log('[USB2SNES] Connected successfully:', result);

      // Notify renderer that device is responding
      event.sender.send('usb2snes:operation-success');

      return {
        connected: true,
        device: result.device,
        devices: result.devices,
        firmwareVersion: result.info.firmwareversion || 'N/A',
        versionString: result.info.versionstring || 'N/A',
        romRunning: result.info.romrunning || 'N/A'
      };
    } catch (error) {
      console.error('[USB2SNES] Connection error:', error);
      throw error;
    }
  });

  ipcMain.handle('usb2snes:ssh-start', async (_event, config) => {
    try {
      const result = await sshManager.start(config || {});
      const status = sshManager.getStatus();
      broadcastUsb2snesSshStatus(status);

      if (result && result.manual) {
        dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          title: 'USB2SNES SSH Tunnel',
          message: 'SSH tunnel started',
          detail: 'Keep the SSH client terminal window open while the tunnel is active. Closing the window will stop the connection.'
        });
      }

      return { success: true, status };
    } catch (error) {
      console.error('[USB2SNES][SSH] Start error:', error);
      const status = sshManager.getStatus();
      broadcastUsb2snesSshStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:ssh-stop', async () => {
    try {
      const result = sshManager.stop();
      broadcastUsb2snesSshStatus(result.status);
      return result;
    } catch (error) {
      console.error('[USB2SNES][SSH] Stop error:', error);
      const status = sshManager.getStatus();
      broadcastUsb2snesSshStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:ssh-status', async () => {
    return sshManager.getStatus();
  });

  ipcMain.handle('usb2snes:ssh-console-history', async () => {
    return sshManager.getConsoleHistory();
  });

  // ===========================================================================
  // USB2SNES EMBEDDED SERVER (USBFXP) OPERATIONS
  // ===========================================================================

  ipcMain.handle('usb2snes:fxp-start', async (_event, config) => {
    try {
      const result = await usbfxpServer.start(config || {});
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: true, status };
    } catch (error) {
      console.error('[USB2SNES][FXP] Start error:', error);
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:fxp-stop', async () => {
    try {
      const result = usbfxpServer.stop();
      broadcastUsb2snesFxpStatus(result.status);
      return result;
    } catch (error) {
      console.error('[USB2SNES][FXP] Stop error:', error);
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:fxp-restart', async (_event, config) => {
    try {
      // Update config if provided
      if (config) {
        usbfxpServer.config = usbfxpServer._normalizeConfig(config);
      }
      const result = await usbfxpServer.restart();
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: true, status };
    } catch (error) {
      console.error('[USB2SNES][FXP] Restart error:', error);
      const status = usbfxpServer.getStatus();
      broadcastUsb2snesFxpStatus(status);
      return { success: false, error: error.message, status };
    }
  });

  ipcMain.handle('usb2snes:fxp-status', async () => {
    return usbfxpServer.getStatus();
  });

  ipcMain.handle('usb2snes:fxp-console-history', async () => {
    return usbfxpServer.getConsoleHistory();
  });

  /**
   * Check USB/serial device permissions
   * Channel: usb2snes:fxp-check-permissions
   * @returns {Promise<Object>} Permission check result
   */
  ipcMain.handle('usb2snes:fxp-check-permissions', async () => {
    const { checkUsbPermissions } = require('./main/usb2snes/usbPermissions');
    return await checkUsbPermissions();
  });

  /**
   * Grant dialout group permission using pkexec
   * Channel: usb2snes:fxp-grant-permission
   * @returns {Promise<{success: boolean, message: string, error?: string}>}
   */
  ipcMain.handle('usb2snes:fxp-grant-permission', async () => {
    const { grantDialoutPermission } = require('./main/usb2snes/usbPermissions');
    return await grantDialoutPermission();
  });

  /**
   * Disconnect from USB2SNES server
   * Channel: usb2snes:disconnect
   */
  ipcMain.handle('usb2snes:disconnect', async () => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.disconnect();
      
      console.log('[USB2SNES] Disconnected');
      
      return { connected: false };
    } catch (error) {
      console.error('[USB2SNES] Disconnect error:', error);
      throw error;
    }
  });

  /**
   * Get USB2SNES connection status
   * Channel: usb2snes:status
   */
  ipcMain.handle('usb2snes:status', async () => {
    try {
      const wrapper = getSnesWrapper();
      
      const status = {
        hasImplementation: wrapper.hasImplementation(),
        implementationType: wrapper.getImplementationType(),
        connected: wrapper.isConnected(),
        attached: wrapper.isAttached(),
        device: wrapper.getDevice(),
        state: wrapper.getState()
      };
      
      console.log('[USB2SNES] Status check:', status);
      return status;
    } catch (error) {
      console.error('[USB2SNES] Status error:', error);
      throw error;
    }
  });

  /**
   * Reset the console
   * Channel: usb2snes:reset
   */
  ipcMain.handle('usb2snes:reset', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.Reset();
      
      console.log('[USB2SNES] Console reset');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Reset error:', error);
      throw error;
    }
  });

  /**
   * Return to menu
   * Channel: usb2snes:menu
   */
  ipcMain.handle('usb2snes:menu', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.Menu();
      
      console.log('[USB2SNES] Returned to menu');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Menu error:', error);
      throw error;
    }
  });

  /**
   * Boot a ROM file
   * Channel: usb2snes:boot
   * @param {string} romPath - Path to ROM on console
   */
  ipcMain.handle('usb2snes:boot', async (event, romPath) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.Boot(romPath);
      
      console.log('[USB2SNES] Booted ROM:', romPath);
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Boot error:', error);
      throw error;
    }
  });

  /**
   * Show native file open dialog
   * Channel: dialog:showOpenDialog
   * @param {Object} options - Dialog options
   */
  ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
    const { dialog } = require('electron');
    // Don't pass a parent window - this can cause freezing on some Linux systems
    return await dialog.showOpenDialog(options);
  });

  /**
   * Read directory contents
   * Channel: fs:readDirectory
   * @param {string} dirPath - Directory path
   */
  ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    const fs = require('fs').promises;
    try {
      const files = await fs.readdir(dirPath);
      return files;
    } catch (error) {
      console.error('[FS] Read directory error:', error);
      throw error;
    }
  });

  /**
   * Launch external program with file
   * Channel: fs:launchProgram
   * @param {string} program - Program path
   * @param {string} args - Arguments with %file placeholder
   * @param {string} filePath - File path to launch
   */
  ipcMain.handle('fs:launchProgram', async (event, program, args, filePath) => {
    const { spawn } = require('child_process');
    const path = require('path');
    
    try {
      console.log('[Launch] Program:', program);
      console.log('[Launch] Args template:', args);
      console.log('[Launch] File:', filePath);
      
      // Quote file path if it contains spaces
      const quotedPath = filePath.includes(' ') ? `"${filePath}"` : filePath;
      
      // Replace %file with the actual file path
      const processedArgs = args.replace(/%file/g, quotedPath);
      
      console.log('[Launch] Processed args:', processedArgs);
      
      // Parse arguments (respecting quotes)
      const argArray = [];
      let currentArg = '';
      let inQuotes = false;
      
      for (let i = 0; i < processedArgs.length; i++) {
        const char = processedArgs[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ' ' && !inQuotes) {
          if (currentArg) {
            argArray.push(currentArg);
            currentArg = '';
          }
        } else {
          currentArg += char;
        }
      }
      
      if (currentArg) {
        argArray.push(currentArg);
      }
      
      console.log('[Launch] Arg array:', argArray);
      
      // Launch the program
      const child = spawn(program, argArray, {
        detached: true,
        stdio: 'ignore'
      });
      
      child.unref();
      
      console.log('[Launch] Process started');
    } catch (error) {
      console.error('[Launch] Error:', error);
      throw error;
    }
  });

  /**
   * Upload ROM file to console
   * Channel: usb2snes:uploadRom
   * @param {string} srcPath - Source file path (local)
   * @param {string} dstPath - Destination path on console
   */
  ipcMain.handle('usb2snes:uploadRom', async (event, srcPath, dstPath) => {
    console.log('[USB2SNES IPC] uploadRom handler called');
    console.log('[USB2SNES IPC] srcPath:', srcPath);
    console.log('[USB2SNES IPC] dstPath:', dstPath);
    
    try {
      const wrapper = getSnesWrapper();
      console.log('[USB2SNES IPC] Wrapper obtained:', !!wrapper);
      
      if (!wrapper) {
        throw new Error('SNESWrapper not initialized');
      }
      
      // Check if file exists
      const fs = require('fs');
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Source file does not exist: ${srcPath}`);
      }
      
      const stats = fs.statSync(srcPath);
      console.log('[USB2SNES IPC] File size:', stats.size, 'bytes');
      
      console.log('[USB2SNES IPC] Starting upload:', srcPath, '->', dstPath);
      
      // Progress callback
      const progressCallback = (transferred, total) => {
        const percent = Math.round((transferred / total) * 100);
        console.log(`[USB2SNES IPC] Upload progress: ${percent}% (${transferred}/${total} bytes)`);
        event.sender.send('usb2snes:upload-progress', { transferred, total, percent });
        // Progress updates mean device is responding - reset health timer
        event.sender.send('usb2snes:operation-success');
      };
      
      console.log('[USB2SNES IPC] Calling wrapper.PutFile()...');
      const success = await wrapper.PutFile(srcPath, dstPath, progressCallback);
      
      console.log('[USB2SNES IPC] PutFile returned:', success);
      console.log('[USB2SNES IPC] Upload complete:', success);
      
      // Notify renderer that USB2SNES operation succeeded (for health tracking)
      event.sender.send('usb2snes:operation-success');
      
      return { success };
    } catch (error) {
      console.error('[USB2SNES IPC] Upload error:', error);
      console.error('[USB2SNES IPC] Error stack:', error.stack);
      throw error;
    }
  });

  /**
   * Read memory from console
   * Channel: usb2snes:readMemory
   * @param {number} address - Memory address
   * @param {number} size - Number of bytes
   */
  ipcMain.handle('usb2snes:readMemory', async (event, address, size) => {
    try {
      const wrapper = getSnesWrapper();
      const data = await wrapper.GetAddress(address, size);
      
      // Handle null response (connection issues)
      if (!data) {
        throw new Error('USB2SNES not responding - connection may be down');
      }
      
      // Convert Buffer to array for IPC transfer
      // Notify renderer that operation succeeded (for health tracking)
      event.sender.send('usb2snes:operation-success');
      return { data: Array.from(data) };
    } catch (error) {
      console.error('[USB2SNES] Read memory error:', error);
      throw error;
    }
  });

  /**
   * Read multiple memory addresses in one call (batch operation)
   * Channel: usb2snes:readMemoryBatch
   * @param {Array<[number, number]>} addressList - Array of [address, size] tuples
   */
  ipcMain.handle('usb2snes:readMemoryBatch', async (event, addressList) => {
    try {
      const wrapper = getSnesWrapper();
      const results = await wrapper.GetAddresses(addressList);
      
      // Handle null response (connection issues)
      if (!results) {
        throw new Error('USB2SNES not responding - connection may be down');
      }
      
      // Convert each Buffer to array for IPC transfer
      const dataArrays = results.map(buffer => Array.from(buffer));
      
      console.log(`[USB2SNES] Batch read complete: ${addressList.length} addresses`);
      event.sender.send('usb2snes:operation-success');
      return { success: true, data: dataArrays };
    } catch (error) {
      console.error('[USB2SNES] Batch read memory error:', error);
      throw error;
    }
  });

  /**
   * Write memory to console
   * Channel: usb2snes:writeMemory
   * @param {Array} writeList - Array of [address, data] tuples
   */
  ipcMain.handle('usb2snes:writeMemory', async (event, writeList) => {
    try {
      const wrapper = getSnesWrapper();
      
      // Convert data arrays to Buffers
      const processedList = writeList.map(([addr, data]) => [
        addr,
        Buffer.from(data)
      ]);
      
      const success = await wrapper.PutAddress(processedList);
      event.sender.send('usb2snes:operation-success');
      return { success };
    } catch (error) {
      console.error('[USB2SNES] Write memory error:', error);
      throw error;
    }
  });

  /**
   * Download file from console
   * Channel: usb2snes:getFile
   * @param {string} filePath - File path on console
   */
  ipcMain.handle('usb2snes:getFile', async (event, filePath) => {
    try {
      const wrapper = getSnesWrapper();
      const data = await wrapper.GetFile(filePath, (received, total) => {
        // Send progress updates to renderer
        event.sender.send('usb2snes:download-progress', {
          filePath,
          received,
          total,
          percent: Math.round(received / total * 100)
        });
        // Progress updates mean device is responding - reset health timer
        event.sender.send('usb2snes:operation-success');
      });
      
      console.log('[USB2SNES] Downloaded file:', filePath, `(${data.length} bytes)`);
      event.sender.send('usb2snes:operation-success');
      return { success: true, data: Array.from(data), size: data.length };
    } catch (error) {
      console.error('[USB2SNES] Get file error:', error);
      throw error;
    }
  });

  /**
   * Blocking file download with timeout
   * Channel: usb2snes:getFileBlocking
   * @param {string} filePath - File path on console
   * @param {number|null} timeoutMs - Timeout in milliseconds
   */
  ipcMain.handle('usb2snes:getFileBlocking', async (event, filePath, timeoutMs = null) => {
    try {
      const wrapper = getSnesWrapper();
      const data = await wrapper.GetFileBlocking(filePath, timeoutMs, (received, total) => {
        // Send progress updates to renderer
        event.sender.send('usb2snes:download-progress', {
          filePath,
          received,
          total,
          percent: Math.round(received / total * 100)
        });
        // Progress updates mean device is responding - reset health timer
        event.sender.send('usb2snes:operation-success');
      });
      
      console.log('[USB2SNES] Downloaded file (blocking):', filePath, `(${data.length} bytes)`);
      event.sender.send('usb2snes:operation-success');
      return { success: true, data: Array.from(data), size: data.length };
    } catch (error) {
      console.error('[USB2SNES] Get file blocking error:', error);
      throw error;
    }
  });

  /**
   * List directory on console
   * Channel: usb2snes:listDir
   * @param {string} dirPath - Directory path
   */
  ipcMain.handle('usb2snes:listDir', async (event, dirPath) => {
    try {
      const wrapper = getSnesWrapper();
      const listing = await wrapper.List(dirPath);
      
      event.sender.send('usb2snes:operation-success');
      return { files: listing };
    } catch (error) {
      console.error('[USB2SNES] List directory error:', error);
      throw error;
    }
  });

  /**
   * Create directory on console
   * Channel: usb2snes:createDir
   * @param {string} dirPath - Directory path to create
   */
  ipcMain.handle('usb2snes:createDir', async (event, dirPath) => {
    try {
      const wrapper = getSnesWrapper();
      await wrapper.MakeDir(dirPath);
      
      console.log('[USB2SNES] Created directory:', dirPath);
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Create directory error:', error);
      throw error;
    }
  });

  // ========================================
  // SMW-SPECIFIC OPERATIONS
  // ========================================

  /**
   * Grant cape powerup to player
   * Channel: usb2snes:smw:grantCape
   */
  ipcMain.handle('usb2snes:smw:grantCape', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      // Set powerup status to cape (0x02)
      await wrapper.PutAddress([[0xF50019, Buffer.from([0x02])]]);
      
      console.log('[USB2SNES] Granted cape powerup');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Grant cape error:', error);
      throw error;
    }
  });

  /**
   * Check if player is in a level
   * Channel: usb2snes:smw:inLevel
   */
  ipcMain.handle('usb2snes:smw:inLevel', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      
      // Use batch read for efficiency - single WebSocket call instead of 6!
      const results = await wrapper.GetAddresses([
        [0xF50010, 1],  // runGame
        [0xF513D4, 1],  // gameUnpaused
        [0xF50071, 1],  // noAnimation
        [0xF51434, 1],  // noEndlevelKeyhole
        [0xF51493, 1],  // noEndlevelTimer
        [0xF50D9B, 1]   // normalLevel
      ]);
      
      // Check all conditions
      const runGame = results[0][0] === 0x00;
      const gameUnpaused = results[1][0] === 0x00;
      const noAnimation = results[2][0] === 0x00;
      const noEndlevelKeyhole = results[3][0] === 0x00;
      const noEndlevelTimer = results[4][0] === 0x00;
      const normalLevel = results[5][0] === 0x00;
      
      const inLevel = runGame && gameUnpaused && noAnimation && 
                      noEndlevelKeyhole && noEndlevelTimer && normalLevel;
      
      event.sender.send('usb2snes:operation-success');
      return { inLevel };
    } catch (error) {
      console.error('[USB2SNES] Check in level error:', error);
      throw error;
    }
  });

  /**
   * Set game timer
   * Channel: usb2snes:smw:setTime
   * @param {number} seconds - Time in seconds
   */
  ipcMain.handle('usb2snes:smw:setTime', async (event, seconds) => {
    try {
      const wrapper = getSnesWrapper();
      
      // Break down time into hundreds, tens, ones (from smwusbtest.py settime())
      const hundreds = Math.floor(seconds / 100);
      const tens = Math.floor((seconds - hundreds * 100) / 10);
      const ones = (seconds - hundreds * 100 - tens * 10) % 10;
      
      await wrapper.PutAddress([
        [0xF50F31, Buffer.from([hundreds])],
        [0xF50F32, Buffer.from([tens])],
        [0xF50F33, Buffer.from([ones])]
      ]);
      
      console.log('[USB2SNES] Set time to:', seconds, 'seconds');
      event.sender.send('usb2snes:operation-success');
      return { success: true };
    } catch (error) {
      console.error('[USB2SNES] Set time error:', error);
      throw error;
    }
  });

  /**
   * Timer challenge: Wait for player to enter level, then set timer to 1 second
   * Channel: usb2snes:smw:timerChallenge
   */
  ipcMain.handle('usb2snes:smw:timerChallenge', async (event) => {
    try {
      const wrapper = getSnesWrapper();
      
      console.log('[USB2SNES] Starting timer challenge - waiting for level entry...');
      
      // Poll for 60 seconds using batch reads for efficiency
      for (let i = 0; i < 60; i++) {
        // Use batch read - 6x faster than individual calls!
        const results = await wrapper.GetAddresses([
          [0xF50010, 1],  // runGame
          [0xF513D4, 1],  // gameUnpaused
          [0xF50071, 1],  // noAnimation
          [0xF51434, 1],  // noEndlevelKeyhole
          [0xF51493, 1],  // noEndlevelTimer
          [0xF50D9B, 1]   // normalLevel
        ]);
        
        // Check all conditions
        const inLevel = results[0][0] === 0x00 &&  // runGame
                        results[1][0] === 0x00 &&  // gameUnpaused
                        results[2][0] === 0x00 &&  // noAnimation
                        results[3][0] === 0x00 &&  // noEndlevelKeyhole
                        results[4][0] === 0x00 &&  // noEndlevelTimer
                        results[5][0] === 0x00;    // normalLevel
        
        if (inLevel) {
          // Player entered level! Set timer to 1 second
          await wrapper.PutAddress([
            [0xF50F31, Buffer.from([0])],  // hundreds
            [0xF50F32, Buffer.from([0])],  // tens
            [0xF50F33, Buffer.from([1])]   // ones
          ]);
          
          console.log('[USB2SNES] Timer challenge complete - set timer to 1 second');
          event.sender.send('usb2snes:operation-success');
          return { success: true, message: 'Player entered level - timer set to 1 second!' };
        }
        
        // Wait 1 second before next check
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Timeout
      console.log('[USB2SNES] Timer challenge timeout - player did not enter level');
      return { success: false, message: 'Timeout: Player did not enter level within 60 seconds' };
    } catch (error) {
      console.error('[USB2SNES] Timer challenge error:', error);
      throw error;
    }
  });

  // ===========================================================================
  // CHAT COMMANDS SYSTEM
  // ===========================================================================

  /**
   * Execute chat command (Chat Hacks + CARL)
   * Channel: chat:executeCommand
   */
  ipcMain.handle('chat:executeCommand', async (event, command) => {
    try {
      const { SMWChatCommands } = require('./main/chat/SMWChatCommands');
      const CarlModuleLoader = require('./main/chat/CarlModuleLoader');
      
      const wrapper = getSnesWrapper();
      
      // Initialize chat commands if not exists
      if (!global.chatCommands) {
        global.chatCommands = new SMWChatCommands(wrapper);
      }
      
      // Initialize CARL loader if not exists
      if (!global.carlLoader) {
        global.carlLoader = new CarlModuleLoader(wrapper);
      }
      
      // Always refresh ASAR path from settings (in case it was updated)
      try {
        const db = dbManager.getConnection('clientdata');
        const asarPathRow = db.prepare(`
          SELECT csetting_value 
          FROM csettings 
          WHERE csetting_name = 'asarPath'
        `).get();
        
        if (asarPathRow && asarPathRow.csetting_value) {
          global.carlLoader.setAsarPath(asarPathRow.csetting_value);
          console.log(`[ChatCommands] ASAR path loaded from settings: ${asarPathRow.csetting_value}`);
        } else {
          console.log('[ChatCommands] No ASAR path found in settings - will use simple assembler fallback');
        }
      } catch (error) {
        console.error('[ChatCommands] Error loading ASAR path from settings:', error);
      }
      
      console.log(`[ChatCommands] Executing: ${command}`);
      
      // Check if this is a CARL command
      if (command.trim().toLowerCase().startsWith('!load ') ||
          command.trim().toLowerCase().startsWith('!unload ') ||
          command.trim().toLowerCase().startsWith('!reload ') ||
          command.trim().toLowerCase() === '!unloadall') {
        
        const result = await global.chatCommands.executeCommand(command);
        
        if (result.success && result.data) {
          // Handle CARL operations
          if (result.data.action === 'load') {
            // Load module from local /work/carl/ directory
            const modulePath = `carl_modules/${result.data.module}.asm`;
            const loadResult = await global.carlLoader.loadModule(result.data.module, modulePath);
            return loadResult;
          } else if (result.data.action === 'unload') {
            return await global.carlLoader.unloadModule(result.data.module);
          } else if (result.data.action === 'reload') {
            const modulePath = `carl_modules/${result.data.module}.asm`;
            return await global.carlLoader.reloadModule(result.data.module, modulePath);
          } else if (result.data.action === 'unloadall') {
            return await global.carlLoader.unloadAll();
          } else if (result.data.action === 'clearhook') {
            return await global.carlLoader.clearFrameHook();
          }
        }
        
        return result;
      }
      
      // Regular chat command
      return await global.chatCommands.executeCommand(command);
      
    } catch (error) {
      console.error('[ChatCommands] Error:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  });

  /**
   * Get chat command history
   * Channel: chat:getHistory
   */
  ipcMain.handle('chat:getHistory', async () => {
    try {
      if (!global.chatCommands) {
        return [];
      }
      return global.chatCommands.getHistory();
    } catch (error) {
      console.error('[ChatCommands] Get history error:', error);
      return [];
    }
  });

  /**
   * Get list of loaded CARL modules
   * Channel: chat:getLoadedModules
   */
  ipcMain.handle('chat:getLoadedModules', async () => {
    try {
      if (!global.carlLoader) {
        return [];
      }
      return global.carlLoader.getLoadedModules();
    } catch (error) {
      console.error('[ChatCommands] Get loaded modules error:', error);
      return [];
    }
  });

  /**
   * Get CARL memory statistics
   * Channel: chat:getMemoryStats
   */
  ipcMain.handle('chat:getMemoryStats', async () => {
    try {
      if (!global.carlLoader) {
        return null;
      }
      return global.carlLoader.getMemoryStats();
    } catch (error) {
      console.error('[ChatCommands] Get memory stats error:', error);
      return null;
    }
  });

  /**
   * Get list of available pseudocommands
   * Channel: chat:getPseudocommands
   */
  ipcMain.handle('chat:getPseudocommands', async () => {
    try {
      const { SMWChatCommands } = require('./main/chat/SMWChatCommands');
      const wrapper = getSnesWrapper();
      const chatCommands = new SMWChatCommands(wrapper);
      return chatCommands.getPseudocommands();
    } catch (error) {
      console.error('[ChatCommands] Get pseudocommands error:', error);
      return [];
    }
  });

  // ===========================================================================
  // SNES CONTENTS CACHE OPERATIONS
  // ===========================================================================
  
  /**
   * Sync SNES /work/ folder with cache
   * Channel: snesContents:sync
   * @param {Object} uploadedFile - File that was just uploaded (optional)
   */
  ipcMain.handle('snesContents:sync', async (event, uploadedFile = null) => {
    try {
      const wrapper = getSnesWrapper();
      
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const manager = new SnesContentsManager(db, wrapper);
      
      await manager.syncWorkFolder(uploadedFile);
      return { success: true };
    } catch (error) {
      console.error('[SnesContents] Sync error:', error);
      throw error;
    }
  });
  
  /**
   * Get list of files on SNES
   * Channel: snesContents:getList
   * @param {boolean} showAll - Include dismissed files
   */
  ipcMain.handle('snesContents:getList', async (event, showAll = false) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const wrapper = getSnesWrapper();
      const manager = new SnesContentsManager(db, wrapper);
      
      return manager.getFileList(showAll);
    } catch (error) {
      console.error('[SnesContents] Get list error:', error);
      throw error;
    }
  });
  
  /**
   * Update file status (pin, dismiss, etc)
   * Channel: snesContents:updateStatus
   * @param {string} fullpath - File path on SNES
   * @param {Object} updates - Status updates
   */
  ipcMain.handle('snesContents:updateStatus', async (event, fullpath, updates) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const wrapper = getSnesWrapper();
      const manager = new SnesContentsManager(db, wrapper);
      
      manager.updateStatus(fullpath, updates);
      return { success: true };
    } catch (error) {
      console.error('[SnesContents] Update status error:', error);
      throw error;
    }
  });
  
  /**
   * Delete file from cache
   * Channel: snesContents:delete
   * @param {string} fullpath - File path on SNES
   */
  ipcMain.handle('snesContents:delete', async (event, fullpath) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { SnesContentsManager } = require('./main/SnesContentsManager');
      const wrapper = getSnesWrapper();
      const manager = new SnesContentsManager(db, wrapper);
      
      manager.deleteFile(fullpath);
      return { success: true };
    } catch (error) {
      console.error('[SnesContents] Delete error:', error);
      throw error;
    }
  });

  // ===========================================================================
  // PAST RUNS OPERATIONS
  // ===========================================================================
  
  /**
   * Get all runs from database
   * Channel: db:runs:get-all
   */
  ipcMain.handle('db:runs:get-all', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const runs = db.prepare(`
        SELECT 
          run_uuid,
          run_name,
          run_description,
          status,
          created_at,
          started_at,
          completed_at,
          updated_at,
          total_challenges,
          completed_challenges,
          skipped_challenges,
          global_conditions,
          pause_seconds,
          staging_folder
        FROM runs
        ORDER BY created_at DESC
      `).all();
      
      return runs;
    } catch (error) {
      console.error('Error getting all runs:', error);
      throw error;
    }
  });
  
  /**
   * Delete a run (cascade deletes results and plan entries)
   * Channel: db:runs:delete
   */
  ipcMain.handle('db:runs:delete', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Delete run (CASCADE will handle run_results and run_plan_entries)
      db.prepare('DELETE FROM runs WHERE run_uuid = ?').run(runUuid);
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting run:', error);
      return { success: false, error: error.message };
    }
  });
  
  /**
   * Get plan entries for a run
   * Channel: db:runs:get-plan-entries
   */
  ipcMain.handle('db:runs:get-plan-entries', async (event, { runUuid }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const entries = db.prepare(`
        SELECT *
        FROM run_plan_entries
        WHERE run_uuid = ?
        ORDER BY sequence_number
      `).all(runUuid);
      
      return entries;
    } catch (error) {
      console.error('Error getting plan entries:', error);
      throw error;
    }
  });

  // ===========================================================================
  // DIALOG OPERATIONS
  // ===========================================================================
  
  /**
   * Select directory dialog
   * Channel: dialog:selectDirectory
   */
  ipcMain.handle('dialog:selectDirectory', async (event, options) => {
    try {
      const result = await dialog.showOpenDialog({
        title: options.title || 'Select Directory',
        properties: options.properties || ['openDirectory'],
        defaultPath: options.defaultPath
      });
      return result;
    } catch (error) {
      console.error('Error in directory selection:', error);
      return { canceled: true };
    }
  });
  
  /**
   * Select files dialog
   * Channel: dialog:selectFiles
   */
  ipcMain.handle('dialog:selectFiles', async (event, options) => {
    try {
      const result = await dialog.showOpenDialog({
        title: options.title || 'Select Files',
        filters: options.filters || [],
        properties: options.properties || ['openFile'],
        defaultPath: options.defaultPath
      });
      return result;
    } catch (error) {
      console.error('Error in file selection:', error);
      return { canceled: true };
    }
  });

  // ===========================================================================
  // GAME EXPORT/IMPORT OPERATIONS
  // ===========================================================================
  
  /**
   * Export selected games to directory
   * Channel: db:games:export
   */
  ipcMain.handle('db:games:export', async (event, { gameIds, exportDirectory }) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const crypto = require('crypto');
      
      let exportedCount = 0;
      
      for (const gameId of gameIds) {
        try {
          // Create export data object
          const exportData = {
            gameid: gameId,
            exported_at: new Date().toISOString(),
            databases: {}
          };
          
          // Export from rhdata.db
          const rhdataDb = dbManager.getConnection('rhdata');
          
          // Get all gameversions for this gameid
          const gameversions = rhdataDb.prepare(`
            SELECT * FROM gameversions WHERE gameid = ?
          `).all(gameId);
          
          if (gameversions.length === 0) {
            console.warn(`No gameversions found for gameid ${gameId}`);
            continue;
          }
          
          exportData.databases.rhdata = {
            gameversions: gameversions,
            gameversion_stats: rhdataDb.prepare(`
              SELECT * FROM gameversion_stats WHERE gameid = ?
            `).all(gameId),
            rhpatches: rhdataDb.prepare(`
              SELECT * FROM rhpatches WHERE gameid = ?
            `).all(gameId)
          };
          
          // Get patchblobs referenced by gameversions
          const patchblobNames = new Set();
          for (const gv of gameversions) {
            if (gv.patchblob1_name) {
              patchblobNames.add(gv.patchblob1_name);
            }
          }
          
          if (patchblobNames.size > 0) {
            const patchblobNamesArray = Array.from(patchblobNames);
            const placeholders = patchblobNamesArray.map(() => '?').join(',');
            
            exportData.databases.rhdata.patchblobs = rhdataDb.prepare(`
              SELECT * FROM patchblobs WHERE patchblob1_name IN (${placeholders})
            `).all(...patchblobNamesArray);
            
            exportData.databases.rhdata.patchblobs_extended = rhdataDb.prepare(`
              SELECT * FROM patchblobs_extended WHERE pbuuid IN (
                SELECT pbuuid FROM patchblobs WHERE patchblob1_name IN (${placeholders})
              )
            `).all(...patchblobNamesArray);
          }
          
          // Export from clientdata.db
          const clientdataDb = dbManager.getConnection('clientdata');
          exportData.databases.clientdata = {
            user_game_annotations: clientdataDb.prepare(`
              SELECT * FROM user_game_annotations WHERE gameid = ?
            `).all(gameId)
          };
          
          // Export from patchbin.db
          const patchbinDb = dbManager.getConnection('patchbin');
          if (patchbinDb) {
            const attachments = [];
            const attachmentFiles = [];
            
            if (patchblobNames.size > 0) {
              // Get pbuuids from patchblobs table first
              const patchblobNamesArray = Array.from(patchblobNames);
              const placeholders = patchblobNamesArray.map(() => '?').join(',');
              
              const patchblobUuids = rhdataDb.prepare(`
                SELECT pbuuid FROM patchblobs WHERE patchblob1_name IN (${placeholders})
              `).all(...patchblobNamesArray).map(pb => pb.pbuuid);
              
              if (patchblobUuids.length > 0) {
                const uuidPlaceholders = patchblobUuids.map(() => '?').join(',');
                
                const attachmentRecords = patchbinDb.prepare(`
                  SELECT * FROM attachments WHERE pbuuid IN (${uuidPlaceholders})
                `).all(...patchblobUuids);
                
                for (const attachment of attachmentRecords) {
                  // Create attachment record without file_data
                  const attachmentRecord = { ...attachment };
                  delete attachmentRecord.file_data;
                  attachments.push(attachmentRecord);
                  
                  // Save file_data to separate file if it exists
                  if (attachment.file_data) {
                    const fileName = sanitizeFileName(attachment.file_name) || attachment.auuid;
                    const filePath = path.join(exportDirectory, fileName);
                    
                    // Convert base64 to buffer and save
                    const fileBuffer = Buffer.from(attachment.file_data, 'base64');
                    await fs.writeFile(filePath, fileBuffer);
                    
                    attachmentFiles.push({
                      auuid: attachment.auuid,
                      file_name: attachment.file_name,
                      saved_as: fileName,
                      file_hash_sha256: attachment.file_hash_sha256
                    });
                  }
                }
              }
            }
            
            exportData.databases.patchbin = {
              attachments: attachments,
              attachment_files: attachmentFiles
            };
          }
          
          // Write export file
          const exportFileName = `${gameId}_info.json`;
          const exportFilePath = path.join(exportDirectory, exportFileName);
          await fs.writeFile(exportFilePath, JSON.stringify(exportData, null, 2));
          
          exportedCount++;
          console.log(`Exported game ${gameId} to ${exportFilePath}`);
          
        } catch (gameError) {
          console.error(`Error exporting game ${gameId}:`, gameError);
        }
      }
      
      return { success: true, exportedCount };
    } catch (error) {
      console.error('Error in export operation:', error);
      return { success: false, error: error.message };
    }
  });
  
  /**
   * Import games from JSON files
   * Channel: db:games:import
   */
  ipcMain.handle('db:games:import', async (event, { filePaths }) => {
    try {
      const fs = require('fs').promises;
      const crypto = require('crypto');
      
      let importedCount = 0;
      const errors = [];
      
      // First pass: import JSON files
      for (const filePath of filePaths) {
        if (!filePath.endsWith('_info.json')) {
          continue; // Skip non-info files in first pass
        }
        
        try {
          const fileContent = await fs.readFile(filePath, 'utf8');
          const exportData = JSON.parse(fileContent);
          
          if (!exportData.gameid || !exportData.databases) {
            errors.push(`Invalid export file: ${filePath}`);
            continue;
          }
          
          const gameId = exportData.gameid;
          
          // Import rhdata.db tables
          if (exportData.databases.rhdata) {
            const rhdataDb = dbManager.getConnection('rhdata');
            
            // Import gameversions
            if (exportData.databases.rhdata.gameversions) {
              for (const gv of exportData.databases.rhdata.gameversions) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO gameversions 
                    (gvuuid, section, gameid, version, removed, obsoleted, gametype, name, time, added, moderated, author, authors, submitter, demo, featured, length, difficulty, url, download_url, name_href, author_href, obsoleted_by, patchblob1_name, pat_sha224, size, description, gvjsondata, gvchange_attributes, gvchanges, tags, tags_href, fields_type, legacy_type, raw_difficulty, combinedtype, local_resource_etag, local_resource_lastmodified, local_resource_filename, gvimport_time, siglistuuid)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    gv.gvuuid, gv.section, gv.gameid, gv.version, gv.removed, gv.obsoleted, gv.gametype, gv.name, gv.time, gv.added, gv.moderated, gv.author, gv.authors, gv.submitter, gv.demo, gv.featured, gv.length, gv.difficulty, gv.url, gv.download_url, gv.name_href, gv.author_href, gv.obsoleted_by, gv.patchblob1_name, gv.pat_sha224, gv.size, gv.description, gv.gvjsondata, gv.gvchange_attributes, gv.gvchanges, gv.tags, gv.tags_href, gv.fields_type, gv.legacy_type, gv.raw_difficulty, gv.combinedtype, gv.local_resource_etag, gv.local_resource_lastmodified, gv.local_resource_filename, gv.gvimport_time, gv.siglistuuid
                  );
                } catch (insertError) {
                  console.warn(`Error inserting gameversion for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import gameversion_stats
            if (exportData.databases.rhdata.gameversion_stats) {
              for (const gvs of exportData.databases.rhdata.gameversion_stats) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO gameversion_stats 
                    (gameid, stat_name, stat_value, stat_type, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                  `).run(
                    gvs.gameid, gvs.stat_name, gvs.stat_value, gvs.stat_type, gvs.created_at, gvs.updated_at
                  );
                } catch (insertError) {
                  console.warn(`Error inserting gameversion_stats for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import rhpatches
            if (exportData.databases.rhdata.rhpatches) {
              for (const rhp of exportData.databases.rhdata.rhpatches) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO rhpatches 
                    (rhpuuid, gameid, patch_name, siglistuuid)
                    VALUES (?, ?, ?, ?)
                  `).run(
                    rhp.rhpuuid, rhp.gameid, rhp.patch_name, rhp.siglistuuid
                  );
                } catch (insertError) {
                  console.warn(`Error inserting rhpatches for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import patchblobs
            if (exportData.databases.rhdata.patchblobs) {
              for (const pb of exportData.databases.rhdata.patchblobs) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO patchblobs 
                    (pbuuid, gvuuid, patch_name, pat_sha1, pat_sha224, pat_shake_128, patchblob1_key, patchblob1_name, patchblob1_sha224, result_sha1, result_sha224, result_shake1, pbjsondata, pblobdata, pbimport_time, siglistuuid)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    pb.pbuuid, pb.gvuuid, pb.patch_name, pb.pat_sha1, pb.pat_sha224, pb.pat_shake_128, pb.patchblob1_key, pb.patchblob1_name, pb.patchblob1_sha224, pb.result_sha1, pb.result_sha224, pb.result_shake1, pb.pbjsondata, pb.pblobdata, pb.pbimport_time, pb.siglistuuid
                  );
                } catch (insertError) {
                  console.warn(`Error inserting patchblobs for ${gameId}:`, insertError);
                }
              }
            }
            
            // Import patchblobs_extended
            if (exportData.databases.rhdata.patchblobs_extended) {
              for (const pbe of exportData.databases.rhdata.patchblobs_extended) {
                try {
                  rhdataDb.prepare(`
                    INSERT OR REPLACE INTO patchblobs_extended 
                    (pbuuid, patch_filename, patch_type, is_primary, zip_source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                  `).run(
                    pbe.pbuuid, pbe.patch_filename, pbe.patch_type, pbe.is_primary, pbe.zip_source, pbe.created_at
                  );
                } catch (insertError) {
                  console.warn(`Error inserting patchblobs_extended for ${gameId}:`, insertError);
                }
              }
            }
          }
          
          // Import clientdata.db tables
          if (exportData.databases.clientdata) {
            const clientdataDb = dbManager.getConnection('clientdata');
            
            if (exportData.databases.clientdata.user_game_annotations) {
              for (const uga of exportData.databases.clientdata.user_game_annotations) {
                try {
                  clientdataDb.prepare(`
                    INSERT OR REPLACE INTO user_game_annotations 
                    (gameid, status, user_difficulty_rating, user_review_rating, user_skill_rating, hidden, exclude_from_random, user_notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    uga.gameid, uga.status, uga.user_difficulty_rating, uga.user_review_rating,
                    uga.user_skill_rating, uga.hidden, uga.exclude_from_random, uga.user_notes
                  );
                } catch (insertError) {
                  console.warn(`Error inserting user_game_annotations for ${gameId}:`, insertError);
                }
              }
            }
          }
          
          // Import patchbin.db tables
          if (exportData.databases.patchbin) {
            const patchbinDb = dbManager.getConnection('patchbin');
            if (patchbinDb) {
              // Import attachments (metadata only)
              if (exportData.databases.patchbin.attachments) {
                for (const att of exportData.databases.patchbin.attachments) {
                  try {
                    patchbinDb.prepare(`
                      INSERT OR REPLACE INTO attachments 
                      (auuid, pbuuid, file_name, file_hash_sha224, file_hash_sha256, file_ipfs_cidv0, file_ipfs_cidv1, file_size, file_type, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                      att.auuid, att.pbuuid, att.file_name, att.file_hash_sha224, att.file_hash_sha256, att.file_ipfs_cidv0, att.file_ipfs_cidv1, att.file_size, att.file_type, att.created_at, att.updated_at
                    );
                  } catch (insertError) {
                    console.warn(`Error inserting attachments for ${gameId}:`, insertError);
                  }
                }
              }
            }
          }
          
          importedCount++;
          console.log(`Imported game ${gameId} from ${filePath}`);
          
        } catch (fileError) {
          errors.push(`Error importing ${filePath}: ${fileError.message}`);
        }
      }
      
      // Second pass: import attachment files (if they exist and match hash)
      for (const filePath of filePaths) {
        if (filePath.endsWith('_info.json')) {
          continue; // Skip info files in second pass
        }
        
        try {
          // This would need to be implemented based on the attachment file structure
          // For now, just log that we found attachment files
          console.log(`Found attachment file: ${filePath}`);
        } catch (fileError) {
          errors.push(`Error processing attachment ${filePath}: ${fileError.message}`);
        }
      }
      
      return { 
        success: true, 
        importedCount, 
        errors: errors.length > 0 ? errors : undefined 
      };
    } catch (error) {
      console.error('Error in import operation:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // ONLINE/NOSTR PROFILE OPERATIONS
  // ===========================================================================

  /**
   * Get online profile
   * Channel: online:profile:get
   */
  ipcMain.handle('online:profile:get', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Load current profile ID
      const currentProfileIdRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_current_profile_id');
      
      const currentProfileId = currentProfileIdRow?.csetting_value || null;
      
      // Load profile from csettings
      const profileJson = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_profile');
      
      if (profileJson) {
        const profile = JSON.parse(profileJson.csetting_value);
        return profile;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting online profile:', error);
      return null;
    }
  });

  /**
   * List all profiles
   * Channel: online:profiles:list
   */
  ipcMain.handle('online:profiles:list', async (event) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      // Get current profile ID
      const currentProfileIdRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_current_profile_id');
      const currentProfileId = currentProfileIdRow?.csetting_value || null;
      
      // Get current profile
      const currentProfileRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_profile');
      
      const profiles = [];
      
      // Add current profile if exists
      if (currentProfileRow && currentProfileId) {
        const currentProfile = JSON.parse(currentProfileRow.csetting_value);
        profiles.push({
          profileId: currentProfileId,
          username: currentProfile.username || 'Unknown',
          displayName: currentProfile.displayName || '',
          isCurrent: true
        });
      }
      
      // Get standby profiles (encrypted)
      const standbyProfilesRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_standby_profiles');
      
      if (standbyProfilesRow) {
        const standbyProfilesJson = standbyProfilesRow.csetting_value;
        
        // Try to decrypt standby profiles
        const keyguardKey = getKeyguardKey(event);
        if (keyguardKey) {
          try {
            const encryptedData = JSON.parse(standbyProfilesJson);
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const encrypted = Buffer.from(encryptedData.data, 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            const standbyProfiles = JSON.parse(decrypted.toString('utf8'));
            
            // Add each standby profile (only metadata, not full profile)
            standbyProfiles.forEach((profile) => {
              if (profile.profileId !== currentProfileId) {
                profiles.push({
                  profileId: profile.profileId,
                  username: profile.username || 'Unknown',
                  displayName: profile.displayName || '',
                  isCurrent: false
                });
              }
            });
          } catch (error) {
            console.error('Error decrypting standby profiles:', error);
          }
        }
      }
      
      return profiles;
    } catch (error) {
      console.error('Error listing profiles:', error);
      return [];
    }
  });

  /**
   * Switch to a different profile
   * Channel: online:profile:switch
   */
  ipcMain.handle('online:profile:switch', async (event, { profileId }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      // Get current profile
      const currentProfileRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_profile');
      const currentProfile = currentProfileRow ? JSON.parse(currentProfileRow.csetting_value) : null;
      const currentProfileIdRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_current_profile_id');
      const currentProfileId = currentProfileIdRow?.csetting_value || null;
      
      // If switching to the same profile, do nothing
      if (profileId === currentProfileId) {
        return { success: true, profile: currentProfile };
      }
      
      // Get keyguard key for encryption
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to switch profiles' };
      }
      
      // Save current profile to standby profiles if it exists
      // We need to get the full profile with private keys from somewhere
      // For now, we'll need to load it differently - the current profile in DB may not have private keys
      // Let's check if we need to get it from standby profiles first
      if (currentProfile && currentProfileId) {
        // Get existing standby profiles
        const standbyProfilesRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('online_standby_profiles');
        
        let standbyProfiles = [];
        if (standbyProfilesRow) {
          try {
            const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const encrypted = Buffer.from(encryptedData.data, 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            standbyProfiles = JSON.parse(decrypted.toString('utf8'));
          } catch (error) {
            console.error('Error decrypting standby profiles:', error);
            standbyProfiles = [];
          }
        }
        
        // Check if current profile exists in standby with full data
        const fullCurrentProfile = standbyProfiles.find((p) => p.profileId === currentProfileId);
        
        // Remove profile from standby if it exists
        standbyProfiles = standbyProfiles.filter((p) => p.profileId !== currentProfileId);
        
        // Use full profile if found, otherwise use current profile (may not have private keys)
        const profileToSave = fullCurrentProfile || currentProfile;
        
        // Merge any updates from currentProfile into the full profile
        if (fullCurrentProfile) {
          // Update displayName, bio, etc. from currentProfile but keep private keys
          Object.keys(currentProfile).forEach(key => {
            if (key !== 'primaryKeypair' && key !== 'additionalKeypairs' && key !== 'adminKeypairs') {
              profileToSave[key] = currentProfile[key];
            }
          });
        }
        
        standbyProfiles.push(profileToSave);
        
        // Encrypt and save standby profiles
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        const standbyProfilesJson = JSON.stringify(standbyProfiles);
        let encrypted = cipher.update(standbyProfilesJson, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const encryptedData = {
          iv: iv.toString('hex'),
          data: encrypted.toString('hex')
        };
        
        const uuid = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid, 'online_standby_profiles', JSON.stringify(encryptedData));
      }
      
      // Load the target profile from standby profiles
      const standbyProfilesRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_standby_profiles');
      
      let targetProfile = null;
      if (standbyProfilesRow) {
        try {
          const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
          const iv = Buffer.from(encryptedData.iv, 'hex');
          const encrypted = Buffer.from(encryptedData.data, 'hex');
          
          const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
          let decrypted = decipher.update(encrypted);
          decrypted = Buffer.concat([decrypted, decipher.final()]);
          
          const standbyProfiles = JSON.parse(decrypted.toString('utf8'));
          targetProfile = standbyProfiles.find((p) => p.profileId === profileId);
        } catch (error) {
          console.error('Error decrypting standby profiles:', error);
        }
      }
      
      if (!targetProfile) {
        return { success: false, error: 'Profile not found' };
      }
      
      // Remove target profile from standby
      const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const encrypted = Buffer.from(encryptedData.data, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      let standbyProfiles = JSON.parse(decrypted.toString('utf8'));
      standbyProfiles = standbyProfiles.filter((p) => p.profileId !== profileId);
      
      // Encrypt and save updated standby profiles
      const newIv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, newIv);
      const standbyProfilesJson = JSON.stringify(standbyProfiles);
      let newEncrypted = cipher.update(standbyProfilesJson, 'utf8');
      newEncrypted = Buffer.concat([newEncrypted, cipher.final()]);
      
      const newEncryptedData = {
        iv: newIv.toString('hex'),
        data: newEncrypted.toString('hex')
      };
      
      const uuid2 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid2, 'online_standby_profiles', JSON.stringify(newEncryptedData));
      
      // Save target profile as current
      const profileToSave = JSON.parse(JSON.stringify(targetProfile));
      // Remove private keys before saving (they should never leave the client)
      if (profileToSave.primaryKeypair?.privateKey) {
        delete profileToSave.primaryKeypair.privateKey;
      }
      if (profileToSave.additionalKeypairs) {
        profileToSave.additionalKeypairs.forEach((kp) => {
          if (kp.privateKey) delete kp.privateKey;
        });
      }
      if (profileToSave.adminKeypairs) {
        profileToSave.adminKeypairs.forEach((kp) => {
          if (kp.privateKey) delete kp.privateKey;
        });
      }
      
      const uuid3 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid3, 'online_profile', JSON.stringify(profileToSave));
      
      // Update current profile ID
      const uuid4 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid4, 'online_current_profile_id', profileId);
      
      return { success: true, profile: targetProfile };
    } catch (error) {
      console.error('Error switching profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Create a new profile (add to standby or make current if no current profile)
   * Channel: online:profile:create-new
   */
  ipcMain.handle('online:profile:create-new', async (event, { profileData }) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      // Check if there's a current profile
      const currentProfileIdRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_current_profile_id');
      const hasCurrentProfile = !!currentProfileIdRow?.csetting_value;
      
      // Get keyguard key for encryption
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to create profiles' };
      }
      
      // If no current profile, make this the current profile
      if (!hasCurrentProfile) {
        const profileToSave = JSON.parse(JSON.stringify(profileData));
        // Remove private keys before saving
        if (profileToSave.primaryKeypair?.privateKey) {
          delete profileToSave.primaryKeypair.privateKey;
        }
        if (profileToSave.additionalKeypairs) {
          profileToSave.additionalKeypairs.forEach((kp) => {
            if (kp.privateKey) delete kp.privateKey;
          });
        }
        if (profileToSave.adminKeypairs) {
          profileToSave.adminKeypairs.forEach((kp) => {
            if (kp.privateKey) delete kp.privateKey;
          });
        }
        
        const uuid = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid, 'online_profile', JSON.stringify(profileToSave));
        
        const uuid2 = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid2, 'online_current_profile_id', profileData.profileId);
        
        return { success: true, profile: profileData, isCurrent: true };
      } else {
        // Add to standby profiles
        const standbyProfilesRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('online_standby_profiles');
        
        let standbyProfiles = [];
        if (standbyProfilesRow) {
          try {
            const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const encrypted = Buffer.from(encryptedData.data, 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            standbyProfiles = JSON.parse(decrypted.toString('utf8'));
          } catch (error) {
            console.error('Error decrypting standby profiles:', error);
            standbyProfiles = [];
          }
        }
        
        // Add new profile
        standbyProfiles.push(profileData);
        
        // Encrypt and save
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        const standbyProfilesJson = JSON.stringify(standbyProfiles);
        let encrypted = cipher.update(standbyProfilesJson, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const encryptedData = {
          iv: iv.toString('hex'),
          data: encrypted.toString('hex')
        };
        
        const uuid = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid, 'online_standby_profiles', JSON.stringify(encryptedData));
        
        return { success: true, profile: profileData, isCurrent: false };
      }
    } catch (error) {
      console.error('Error creating new profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import profile from encrypted file
   * Channel: online:profile:import
   */
  ipcMain.handle('online:profile:import', async (event, { filePath, password, overwriteExisting }) => {
    try {
      const fs = require('fs');
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Read encrypted file
      const encryptedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Derive key from password using PBKDF2
      const salt = Buffer.from(encryptedData.salt, 'hex');
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Decrypt profile
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const encrypted = Buffer.from(encryptedData.data, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      const importedProfile = JSON.parse(decrypted.toString('utf8'));
      
      // Check if profile already exists
      const currentProfileIdRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_current_profile_id');
      const currentProfileId = currentProfileIdRow?.csetting_value || null;
      
      let profileExists = false;
      if (importedProfile.profileId === currentProfileId) {
        profileExists = true;
      } else {
        // Check standby profiles
        const standbyProfilesRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('online_standby_profiles');
        
        if (standbyProfilesRow) {
          const keyguardKey = getKeyguardKey(event);
          if (keyguardKey) {
            try {
              const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
              const iv = Buffer.from(encryptedData.iv, 'hex');
              const encrypted = Buffer.from(encryptedData.data, 'hex');
              
              const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
              let decrypted = decipher.update(encrypted);
              decrypted = Buffer.concat([decrypted, decipher.final()]);
              
              const standbyProfiles = JSON.parse(decrypted.toString('utf8'));
              profileExists = standbyProfiles.some((p) => p.profileId === importedProfile.profileId);
            } catch (error) {
              console.error('Error checking standby profiles:', error);
            }
          }
        }
      }
      
      if (profileExists && !overwriteExisting) {
        return { success: false, error: 'Profile already exists. Enable overwrite to replace it.' };
      }
      
      // Get keyguard key for saving
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to import profiles' };
      }
      
      // If overwriting current profile
      if (importedProfile.profileId === currentProfileId) {
        const profileToSave = JSON.parse(JSON.stringify(importedProfile));
        // Remove private keys before saving
        if (profileToSave.primaryKeypair?.privateKey) {
          delete profileToSave.primaryKeypair.privateKey;
        }
        if (profileToSave.additionalKeypairs) {
          profileToSave.additionalKeypairs.forEach((kp) => {
            if (kp.privateKey) delete kp.privateKey;
          });
        }
        if (profileToSave.adminKeypairs) {
          profileToSave.adminKeypairs.forEach((kp) => {
            if (kp.privateKey) delete kp.privateKey;
          });
        }
        
        const uuid = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid, 'online_profile', JSON.stringify(profileToSave));
        
        return { success: true, profile: importedProfile, isCurrent: true };
      } else {
        // Add to standby profiles (or replace if exists)
        const standbyProfilesRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('online_standby_profiles');
        
        let standbyProfiles = [];
        if (standbyProfilesRow) {
          try {
            const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const encrypted = Buffer.from(encryptedData.data, 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            standbyProfiles = JSON.parse(decrypted.toString('utf8'));
            // Remove existing profile if overwriting
            standbyProfiles = standbyProfiles.filter((p) => p.profileId !== importedProfile.profileId);
          } catch (error) {
            console.error('Error decrypting standby profiles:', error);
            standbyProfiles = [];
          }
        }
        
        // Add imported profile
        standbyProfiles.push(importedProfile);
        
        // Encrypt and save
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        const standbyProfilesJson = JSON.stringify(standbyProfiles);
        let encrypted = cipher.update(standbyProfilesJson, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const encryptedData2 = {
          iv: iv.toString('hex'),
          data: encrypted.toString('hex')
        };
        
        const uuid = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid, 'online_standby_profiles', JSON.stringify(encryptedData2));
        
        return { success: true, profile: importedProfile, isCurrent: false };
      }
    } catch (error) {
      console.error('Error importing profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Create new online profile (legacy - kept for compatibility)
   * Channel: online:profile:create
   */
  ipcMain.handle('online:profile:create', async (event, { keyType }) => {
    try {
      // TODO: Implement actual keypair generation using cryptographic libraries
      // For now, return a placeholder structure
      const profile = {
        displayName: '',
        bio: '',
        primaryKeypair: {
          type: keyType || 'ML-DSA-44',
          publicKey: 'PLACEHOLDER_PUBLIC_KEY_' + Date.now(),
          privateKey: 'PLACEHOLDER_PRIVATE_KEY_' + Date.now() // Never transmitted
        },
        additionalKeypairs: [],
        adminKeypairs: [],
        isAdmin: false
      };
      
      // Save to database
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      const uuid = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'online_profile', JSON.stringify(profile));
      
      return { success: true, profile };
    } catch (error) {
      console.error('Error creating online profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save online profile
   * Channel: online:profile:save
   * Note: This saves the current profile. Private keys are stored encrypted in standby profiles.
   */
  ipcMain.handle('online:profile:save', async (event, profile) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      
      // Get current profile ID
      const currentProfileIdRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_current_profile_id');
      let currentProfileId = currentProfileIdRow?.csetting_value || null;
      
      // If no current profile ID but profile has profileId, use it
      if (!currentProfileId && profile.profileId) {
        currentProfileId = profile.profileId;
      }
      
      // Get keyguard key for encryption
      const keyguardKey = getKeyguardKey(event);
      if (!keyguardKey) {
        return { success: false, error: 'Profile Guard must be unlocked to save profiles' };
      }
      
      // Get existing standby profiles to preserve full profile with private keys
      const standbyProfilesRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_standby_profiles');
      
      let standbyProfiles = [];
      if (standbyProfilesRow) {
        try {
          const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
          const iv = Buffer.from(encryptedData.iv, 'hex');
          const encrypted = Buffer.from(encryptedData.data, 'hex');
          
          const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
          let decrypted = decipher.update(encrypted);
          decrypted = Buffer.concat([decrypted, decipher.final()]);
          
          standbyProfiles = JSON.parse(decrypted.toString('utf8'));
        } catch (error) {
          console.error('Error decrypting standby profiles:', error);
          standbyProfiles = [];
        }
      }
      
      // Find existing full profile in standby
      const existingFullProfileIndex = standbyProfiles.findIndex((p) => p.profileId === currentProfileId);
      
      // Merge updates into full profile, preserving private keys
      if (existingFullProfileIndex >= 0) {
        const fullProfile = standbyProfiles[existingFullProfileIndex];
        // Update all fields except keypairs (which need special handling)
        Object.keys(profile).forEach(key => {
          if (key !== 'primaryKeypair' && key !== 'additionalKeypairs' && key !== 'adminKeypairs') {
            fullProfile[key] = profile[key];
          }
        });
        // Update keypair metadata but preserve private keys
        if (profile.primaryKeypair && fullProfile.primaryKeypair) {
          Object.keys(profile.primaryKeypair).forEach(key => {
            if (key !== 'privateKey') {
              fullProfile.primaryKeypair[key] = profile.primaryKeypair[key];
            }
          });
        }
        standbyProfiles[existingFullProfileIndex] = fullProfile;
      } else {
        // If not in standby, add it (profile was just created or switched)
        standbyProfiles.push(profile);
      }
      
      // Encrypt and save standby profiles
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
      const standbyProfilesJson = JSON.stringify(standbyProfiles);
      let encrypted = cipher.update(standbyProfilesJson, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      const encryptedData = {
        iv: iv.toString('hex'),
        data: encrypted.toString('hex')
      };
      
      const uuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'online_standby_profiles', JSON.stringify(encryptedData));
      
      // Save current profile without private keys (for display)
      const profileToSave = JSON.parse(JSON.stringify(profile));
      if (profileToSave.primaryKeypair?.privateKey) {
        delete profileToSave.primaryKeypair.privateKey;
      }
      if (profileToSave.additionalKeypairs) {
        profileToSave.additionalKeypairs.forEach((kp) => {
          if (kp.privateKey) delete kp.privateKey;
        });
      }
      if (profileToSave.adminKeypairs) {
        profileToSave.adminKeypairs.forEach((kp) => {
          if (kp.privateKey) delete kp.privateKey;
        });
      }
      
      const uuid2 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid2, 'online_profile', JSON.stringify(profileToSave));
      
      // Update current profile ID if not set
      if (!currentProfileId && profile.profileId) {
        const uuid3 = crypto.randomUUID();
        db.prepare(`
          INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
          VALUES (?, ?, ?)
          ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
        `).run(uuid3, 'online_current_profile_id', profile.profileId);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error saving online profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get Profile Guard key for encryption
   * Helper function to get the keyguard key from session or storage
   */
  function getKeyguardKey(event) {
    // First try to get from session (if unlocked in high security mode)
    if (event.sender.session.keyguardKey) {
      return event.sender.session.keyguardKey;
    }
    
    // Otherwise try to get from safeStorage
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) {
      const db = dbManager.getConnection('clientdata');
      const encryptedKeyRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_encrypted');
      
      if (encryptedKeyRow) {
        try {
          const encryptedKey = Buffer.from(encryptedKeyRow.csetting_value, 'base64');
          const keyHex = safeStorage.decryptString(encryptedKey);
          return Buffer.from(keyHex, 'hex');
        } catch (error) {
          console.warn('Error decrypting keyguard key:', error);
        }
      }
    }
    
    return null;
  }

  /**
   * Generate keypair based on type
   * @param {string} keyType - ML-DSA-44, ML-DSA-87, ED25519, or RSA-2048
   * @returns {Promise<Object>} Keypair with publicKey, privateKey, and metadata
   */
  async function generateKeypair(keyType) {
    const crypto = require('crypto');
    
    switch (keyType) {
      case 'ED25519': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        });
        
        // Convert to hex for fingerprint calculation
        const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
        const fingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('hex');
        
        return {
          type: 'ED25519',
          publicKey: publicKey,
          privateKey: privateKey,
          publicKeyHex: publicKeyDer.toString('hex'),
          fingerprint: fingerprint
        };
      }
      
      case 'RSA-2048': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        });
        
        const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
        const fingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('hex');
        
        return {
          type: 'RSA-2048',
          publicKey: publicKey,
          privateKey: privateKey,
          publicKeyHex: publicKeyDer.toString('hex'),
          fingerprint: fingerprint
        };
      }
      
      case 'ML-DSA-44': {
        // ML-DSA-44: Post-quantum algorithm (FIPS 204)
        // Use dynamic import since @noble/post-quantum is an ES module
        const mlDsaModule = await import('@noble/post-quantum/ml-dsa.js');
        const ml_dsa44 = mlDsaModule.ml_dsa44;
        
        // Generate keypair
        // Note: @noble/post-quantum uses 'secretKey' not 'privateKey'
        const { publicKey, secretKey } = ml_dsa44.keygen();
        
        // Convert Uint8Array to hex for storage (must convert immediately to avoid cloning issues)
        const publicKeyHex = Buffer.from(publicKey).toString('hex');
        const privateKeyHex = Buffer.from(secretKey).toString('hex');
        
        // Generate fingerprint from public key (must use Buffer, not Uint8Array directly)
        const fingerprint = crypto.createHash('sha256').update(Buffer.from(publicKey)).digest('hex');
        
        // Convert to PEM-like format for consistency with other key types
        const publicKeyBase64 = Buffer.from(publicKey).toString('base64');
        const publicKeyWrapped = publicKeyBase64.match(/.{1,64}/g) ? publicKeyBase64.match(/.{1,64}/g).join('\n') : publicKeyBase64;
        const publicKeyPem = `-----BEGIN ML-DSA-44 PUBLIC KEY-----\n` +
          publicKeyWrapped + '\n' +
          `-----END ML-DSA-44 PUBLIC KEY-----`;
        
        const privateKeyBase64 = Buffer.from(secretKey).toString('base64');
        const privateKeyWrapped = privateKeyBase64.match(/.{1,64}/g) ? privateKeyBase64.match(/.{1,64}/g).join('\n') : privateKeyBase64;
        const privateKeyPem = `-----BEGIN ML-DSA-44 PRIVATE KEY-----\n` +
          privateKeyWrapped + '\n' +
          `-----END ML-DSA-44 PRIVATE KEY-----`;
        
        return {
          type: 'ML-DSA-44',
          publicKey: publicKeyPem,
          privateKey: privateKeyPem,
          publicKeyHex: publicKeyHex,
          privateKeyRaw: privateKeyHex, // Store raw private key for encryption
          fingerprint: fingerprint
        };
      }
      
      case 'ML-DSA-87': {
        // ML-DSA-87: Post-quantum algorithm (FIPS 204) - higher security level
        // Use dynamic import since @noble/post-quantum is an ES module
        const mlDsaModule = await import('@noble/post-quantum/ml-dsa.js');
        const ml_dsa87 = mlDsaModule.ml_dsa87;
        
        // Generate keypair
        // Note: @noble/post-quantum uses 'secretKey' not 'privateKey'
        const { publicKey, secretKey } = ml_dsa87.keygen();
        
        // Convert Uint8Array to hex for storage (must convert immediately to avoid cloning issues)
        const publicKeyHex = Buffer.from(publicKey).toString('hex');
        const privateKeyHex = Buffer.from(secretKey).toString('hex');
        
        // Generate fingerprint from public key (must use Buffer, not Uint8Array directly)
        const fingerprint = crypto.createHash('sha256').update(Buffer.from(publicKey)).digest('hex');
        
        // Convert to PEM-like format for consistency with other key types
        const publicKeyBase64 = Buffer.from(publicKey).toString('base64');
        const publicKeyWrapped = publicKeyBase64.match(/.{1,64}/g) ? publicKeyBase64.match(/.{1,64}/g).join('\n') : publicKeyBase64;
        const publicKeyPem = `-----BEGIN ML-DSA-87 PUBLIC KEY-----\n` +
          publicKeyWrapped + '\n' +
          `-----END ML-DSA-87 PUBLIC KEY-----`;
        
        const privateKeyBase64 = Buffer.from(secretKey).toString('base64');
        const privateKeyWrapped = privateKeyBase64.match(/.{1,64}/g) ? privateKeyBase64.match(/.{1,64}/g).join('\n') : privateKeyBase64;
        const privateKeyPem = `-----BEGIN ML-DSA-87 PRIVATE KEY-----\n` +
          privateKeyWrapped + '\n' +
          `-----END ML-DSA-87 PRIVATE KEY-----`;
        
        return {
          type: 'ML-DSA-87',
          publicKey: publicKeyPem,
          privateKey: privateKeyPem,
          publicKeyHex: publicKeyHex,
          privateKeyRaw: privateKeyHex, // Store raw private key for encryption
          fingerprint: fingerprint
        };
      }
      
      default:
        throw new Error(`Unsupported key type: ${keyType}`);
    }
  }

  /**
   * Generate local name for keypair
   * Format: username_type_digits
   * @param {string} username - User's username
   * @param {string} keyType - Key type (ML-DSA-44, ED25519, etc.)
   * @param {string} fingerprint - SHA256 fingerprint
   * @returns {string} Local name
   */
  function generateLocalKeypairName(username, keyType, fingerprint) {
    // Use last 6 hex digits of fingerprint as distinguishing digits
    const digits = fingerprint.slice(-6);
    const typeNormalized = keyType.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return `${username}_${typeNormalized}_${digits}`;
  }

  /**
   * Generate canonical remote name for keypair
   * Format: type_fingerprint or type_publickey
   * @param {string} keyType - Key type
   * @param {string} fingerprint - SHA256 fingerprint
   * @param {string} publicKeyHex - Public key in hex format (optional)
   * @param {boolean} usePublicKey - If true, use full public key instead of fingerprint
   * @returns {string} Canonical remote name
   */
  function generateCanonicalKeypairName(keyType, fingerprint, publicKeyHex, usePublicKey = false) {
    const typeNormalized = keyType.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (usePublicKey && publicKeyHex) {
      return `${typeNormalized}_${publicKeyHex}`;
    }
    return `${typeNormalized}_${fingerprint}`;
  }

  /**
   * Create online keypair
   * Channel: online:keypair:create
   */
  ipcMain.handle('online:keypair:create', async (event, { keyType, isPrimary, username }) => {
    try {
      const crypto = require('crypto');
      
      // Get username from profile if not provided
      let usernameForName = username;
      if (!usernameForName) {
        const db = dbManager.getConnection('clientdata');
        const profileJson = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('online_profile');
        
        if (profileJson) {
          const profile = JSON.parse(profileJson.csetting_value);
          usernameForName = profile.username || 'user';
        } else {
          usernameForName = 'user';
        }
      }
      
      // Generate actual keypair
      const keypairData = await generateKeypair(keyType || 'ML-DSA-44');
      
      // Generate names
      const localName = generateLocalKeypairName(usernameForName, keypairData.type, keypairData.fingerprint);
      const canonicalName = generateCanonicalKeypairName(keypairData.type, keypairData.fingerprint, keypairData.publicKeyHex);
      
      // Create keypair object with only serializable values (strings, numbers)
      // Ensure all values are plain JavaScript types for IPC serialization
      const keypair = {
        type: String(keypairData.type),
        publicKey: String(keypairData.publicKey),
        privateKey: String(keypairData.privateKey),
        publicKeyHex: String(keypairData.publicKeyHex),
        fingerprint: String(keypairData.fingerprint),
        localName: String(localName),
        canonicalName: String(canonicalName),
        createdAt: String(new Date().toISOString())
      };
      
      // Include privateKeyRaw if available (for ML-DSA encryption) - ensure it's a string
      if (keypairData.privateKeyRaw) {
        keypair.privateKeyRaw = String(keypairData.privateKeyRaw);
      }
      
      // Encrypt private key with Profile Guard if available
      const keyguardKey = getKeyguardKey(event);
      if (keyguardKey) {
        // Encrypt private key
        // For ML-DSA, use privateKeyRaw if available (hex format), otherwise use PEM format
        const keyToEncrypt = keypair.privateKeyRaw || keypair.privateKey;
        const keyData = keypair.privateKeyRaw ? Buffer.from(keyToEncrypt, 'hex') : Buffer.from(keyToEncrypt, 'utf8');
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        let encrypted = cipher.update(keyData);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        // Store encrypted private key as hex string
        keypair.privateKey = iv.toString('hex') + ':' + encrypted.toString('hex');
        // Store format indicator for decryption
        keypair.privateKeyFormat = keypair.privateKeyRaw ? 'hex' : 'pem';
        keypair.encrypted = true;
        // Remove raw private key from unencrypted output
        delete keypair.privateKeyRaw;
      } else {
        // Check if Profile Guard is enabled (user needs to unlock)
        const db = dbManager.getConnection('clientdata');
        const saltRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('keyguardsalt');
        
        if (saltRow) {
          return { success: false, error: 'Profile Guard is enabled but not unlocked. Please unlock Profile Guard first.' };
        }
      }
      
      return { success: true, keypair };
    } catch (error) {
      console.error('Error creating keypair:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Regenerate online keypair
   * Channel: online:keypair:regenerate
   */
  ipcMain.handle('online:keypair:regenerate', async (event, { keyType, username }) => {
    try {
      // Get username from profile if not provided
      let usernameForName = username;
      if (!usernameForName) {
        const db = dbManager.getConnection('clientdata');
        const profileJson = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('online_profile');
        
        if (profileJson) {
          const profile = JSON.parse(profileJson.csetting_value);
          usernameForName = profile.username || 'user';
        } else {
          usernameForName = 'user';
        }
      }
      
      // Generate new keypair (same as create)
      const keypairData = await generateKeypair(keyType || 'ML-DSA-44');
      
      // Generate names
      const localName = generateLocalKeypairName(usernameForName, keypairData.type, keypairData.fingerprint);
      const canonicalName = generateCanonicalKeypairName(keypairData.type, keypairData.fingerprint, keypairData.publicKeyHex);
      
      // Create keypair object with only serializable values (strings, numbers)
      // Ensure all values are plain JavaScript types for IPC serialization
      const keypair = {
        type: String(keypairData.type),
        publicKey: String(keypairData.publicKey),
        privateKey: String(keypairData.privateKey),
        publicKeyHex: String(keypairData.publicKeyHex),
        fingerprint: String(keypairData.fingerprint),
        localName: String(localName),
        canonicalName: String(canonicalName),
        createdAt: String(new Date().toISOString())
      };
      
      // Include privateKeyRaw if available (for ML-DSA encryption) - ensure it's a string
      if (keypairData.privateKeyRaw) {
        keypair.privateKeyRaw = String(keypairData.privateKeyRaw);
      }
      
      // Encrypt private key with Profile Guard if available
      const keyguardKey = getKeyguardKey(event);
      if (keyguardKey) {
        const crypto = require('crypto');
        // Encrypt private key
        // For ML-DSA, use privateKeyRaw if available (hex format), otherwise use PEM format
        const keyToEncrypt = keypair.privateKeyRaw || keypair.privateKey;
        const keyData = keypair.privateKeyRaw ? Buffer.from(keyToEncrypt, 'hex') : Buffer.from(keyToEncrypt, 'utf8');
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyguardKey, iv);
        let encrypted = cipher.update(keyData);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        // Store encrypted private key as hex string
        keypair.privateKey = iv.toString('hex') + ':' + encrypted.toString('hex');
        // Store format indicator for decryption
        keypair.privateKeyFormat = keypair.privateKeyRaw ? 'hex' : 'pem';
        keypair.encrypted = true;
        // Remove raw private key from unencrypted output
        delete keypair.privateKeyRaw;
      } else {
        // Check if Profile Guard is enabled (user needs to unlock)
        const db = dbManager.getConnection('clientdata');
        const saltRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('keyguardsalt');
        
        if (saltRow) {
          return { success: false, error: 'Profile Guard is enabled but not unlocked. Please unlock Profile Guard first.' };
        }
      }
      
      return { success: true, keypair };
    } catch (error) {
      console.error('Error regenerating keypair:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get admin master keys
   * Channel: online:master-keys:get
   */
  ipcMain.handle('online:master-keys:get', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      const masterKeysJson = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('online_master_keys');
      
      if (masterKeysJson) {
        return JSON.parse(masterKeysJson.csetting_value);
      }
      
      return [];
    } catch (error) {
      console.error('Error getting master keys:', error);
      return [];
    }
  });

  /**
   * Save admin master keys
   * Channel: online:master-keys:save
   */
  ipcMain.handle('online:master-keys:save', async (event, masterKeys) => {
    try {
      const db = dbManager.getConnection('clientdata');
      const crypto = require('crypto');
      const uuid = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'online_master_keys', JSON.stringify(masterKeys));
      
      return { success: true };
    } catch (error) {
      console.error('Error saving master keys:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Copy text to clipboard
   * Channel: clipboard:write
   */
  ipcMain.handle('clipboard:write', async (event, text) => {
    try {
      const { clipboard } = require('electron');
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================================================
  // PROFILE GUARD OPERATIONS
  // ===========================================================================

  /**
   * Check Profile Guard status
   * Channel: profile-guard:check
   */
  ipcMain.handle('profile-guard:check', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      const { safeStorage } = require('electron');
      
      // Check if keyguard salt exists (indicates Profile Guard is set up)
      const saltRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguardsalt');
      
      if (!saltRow) {
        return { enabled: false };
      }
      
      // Check high security mode setting
      const highSecurityRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_high_security_mode');
      
      const highSecurityMode = highSecurityRow?.csetting_value === 'true';
      
      // Check if key is stored in safeStorage (only if not in high security mode)
      let keyStored = false;
      if (!highSecurityMode && safeStorage.isEncryptionAvailable()) {
        try {
          const stored = db.prepare(`
            SELECT csetting_value FROM csettings WHERE csetting_name = ?
          `).get('keyguard_key_stored');
          keyStored = stored !== null;
        } catch (error) {
          // Key not stored
        }
      }
      
      return { 
        enabled: true,
        highSecurityMode: highSecurityMode,
        keyStored: keyStored
      };
    } catch (error) {
      console.error('Error checking Profile Guard status:', error);
      return { enabled: false };
    }
  });

  /**
   * Set up Profile Guard
   * Channel: profile-guard:setup
   */
  ipcMain.handle('profile-guard:setup', async (event, { password, highSecurityMode }) => {
    try {
      const crypto = require('crypto');
      const { safeStorage } = require('electron');
      const db = dbManager.getConnection('clientdata');
      
      // Generate random 32-byte salt
      const salt = crypto.randomBytes(32);
      
      // Derive encryption key from password using PBKDF2
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Create SHA512 hash of the derived key for verification
      const keyHash = crypto.createHash('sha512').update(key).digest('hex');
      
      // Store salt in database
      const uuid1 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid1, 'keyguardsalt', salt.toString('hex'));
      
      // Store SHA512 hash of key for verification
      const uuid2 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid2, 'keyguard_key_hash', keyHash);
      
      // Store high security mode setting
      const uuid3 = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid3, 'keyguard_high_security_mode', highSecurityMode ? 'true' : 'false');
      
      // Store key in safeStorage if not in high security mode
      if (!highSecurityMode && safeStorage.isEncryptionAvailable()) {
        try {
          const encryptedKey = safeStorage.encryptString(key.toString('hex'));
          const uuid4 = crypto.randomUUID();
          db.prepare(`
            INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
            VALUES (?, ?, ?)
            ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
          `).run(uuid4, 'keyguard_key_encrypted', encryptedKey.toString('base64'));
          
          const uuid5 = crypto.randomUUID();
          db.prepare(`
            INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
            VALUES (?, ?, ?)
            ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
          `).run(uuid5, 'keyguard_key_stored', 'true');
        } catch (error) {
          console.warn('Could not store key in safeStorage:', error);
        }
      }
      
      return { success: true, highSecurityMode: highSecurityMode };
    } catch (error) {
      console.error('Error setting up Profile Guard:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update Profile Guard security mode
   * Channel: profile-guard:update-security-mode
   */
  ipcMain.handle('profile-guard:update-security-mode', async (event, { highSecurityMode }) => {
    try {
      const { safeStorage } = require('electron');
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Update high security mode setting
      const uuid = crypto.randomUUID();
      db.prepare(`
        INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
        ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
      `).run(uuid, 'keyguard_high_security_mode', highSecurityMode ? 'true' : 'false');
      
      if (highSecurityMode) {
        // Remove stored key if switching to high security mode
        db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_encrypted');
        db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_stored');
      } else {
        // Store key if switching away from high security mode
        // Need to get the key from password - but we can't do that without the password
        // So we'll just mark that it needs to be stored next time user unlocks
        // For now, we'll require user to change password to enable saving
        return { success: false, error: 'Please change your master password to enable key storage' };
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error updating security mode:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Verify Profile Guard password (for High Security Mode)
   * Channel: profile-guard:verify-password
   */
  ipcMain.handle('profile-guard:verify-password', async (event, { password }) => {
    try {
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Get salt and stored hash
      const saltRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguardsalt');
      
      const hashRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_hash');
      
      if (!saltRow || !hashRow) {
        return { success: false, error: 'Profile Guard not set up' };
      }
      
      const salt = Buffer.from(saltRow.csetting_value, 'hex');
      const storedHash = hashRow.csetting_value;
      
      // Derive key from password
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Compute hash of derived key
      const computedHash = crypto.createHash('sha512').update(key).digest('hex');
      
      // Verify against stored hash
      if (computedHash !== storedHash) {
        return { success: false, error: 'Invalid password' };
      }
      
      // Store key in memory for this session (not persisted)
      // This will be used for encrypting/decrypting keys
      event.sender.session.keyguardKey = key;
      
      return { success: true };
    } catch (error) {
      console.error('Error verifying password:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Unlock Profile Guard (auto-unlock if not in high security mode)
   * Channel: profile-guard:unlock
   */
  ipcMain.handle('profile-guard:unlock', async (event) => {
    try {
      const { safeStorage } = require('electron');
      const crypto = require('crypto');
      const db = dbManager.getConnection('clientdata');
      
      // Check high security mode
      const highSecurityRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_high_security_mode');
      
      const highSecurityMode = highSecurityRow?.csetting_value === 'true';
      
      if (highSecurityMode) {
        // Can't auto-unlock in high security mode
        return { success: false, error: 'Password required in high security mode' };
      }
      
      // Try to get key from safeStorage
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: 'Encryption not available on this platform' };
      }
      
      const encryptedKeyRow = db.prepare(`
        SELECT csetting_value FROM csettings WHERE csetting_name = ?
      `).get('keyguard_key_encrypted');
      
      if (!encryptedKeyRow) {
        return { success: false, error: 'Key not stored' };
      }
      
      try {
        const encryptedKey = Buffer.from(encryptedKeyRow.csetting_value, 'base64');
        const keyHex = safeStorage.decryptString(encryptedKey);
        const key = Buffer.from(keyHex, 'hex');
        
        // Store key in memory for this session
        event.sender.session.keyguardKey = key;
        
        return { success: true };
      } catch (error) {
        console.error('Error decrypting key:', error);
        return { success: false, error: 'Failed to decrypt stored key' };
      }
    } catch (error) {
      console.error('Error unlocking Profile Guard:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Remove Profile Guard
   * Channel: profile-guard:remove
   */
  ipcMain.handle('profile-guard:remove', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Remove all Profile Guard settings
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguardsalt');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_hash');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_encrypted');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_stored');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_high_security_mode');
      
      return { success: true };
    } catch (error) {
      console.error('Error removing Profile Guard:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete Profile Guard secrets (forgot password option)
   * Channel: profile-guard:delete-secrets
   * This deletes Profile Guard and all encrypted secret keys/keypairs
   */
  ipcMain.handle('profile-guard:delete-secrets', async () => {
    try {
      const db = dbManager.getConnection('clientdata');
      
      // Remove all Profile Guard settings
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguardsalt');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_hash');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_encrypted');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_key_stored');
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('keyguard_high_security_mode');
      
      // Delete online profile (which contains encrypted keypairs)
      db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('online_profile');
      
      // Clear any session-stored keys
      // Note: This is per-session, so we can't clear it from here
      // But the profile deletion above will prevent access to encrypted data
      
      return { success: true };
    } catch (error) {
      console.error('Error deleting Profile Guard secrets:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export online profile with password-based encryption
   * Channel: online:profile:export
   * Supports both legacy format ({profile, password}) and new format ({profileId, password, filePath})
   */
  ipcMain.handle('online:profile:export', async (event, params) => {
    try {
      const crypto = require('crypto');
      const { dialog } = require('electron');
      const fs = require('fs');
      const db = dbManager.getConnection('clientdata');
      
      let profileToExport = null;
      let filePath = null;
      let password = null;
      
      // Support both legacy and new formats
      if (params.profileId) {
        // New format: profileId, password, filePath
        profileToExport = null;
        password = params.password;
        filePath = params.filePath;
        
        // Get keyguard key for decryption
        const keyguardKey = getKeyguardKey(event);
        if (!keyguardKey) {
          return { success: false, error: 'Profile Guard must be unlocked to export profiles' };
        }
        
        // Get current profile ID
        const currentProfileIdRow = db.prepare(`
          SELECT csetting_value FROM csettings WHERE csetting_name = ?
        `).get('online_current_profile_id');
        const currentProfileId = currentProfileIdRow?.csetting_value || null;
        
        // If exporting current profile, try to get full version from standby first
        if (params.profileId === currentProfileId) {
          // Check standby profiles first for full version
          const standbyProfilesRow = db.prepare(`
            SELECT csetting_value FROM csettings WHERE csetting_name = ?
          `).get('online_standby_profiles');
          
          if (standbyProfilesRow) {
            try {
              const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
              const iv = Buffer.from(encryptedData.iv, 'hex');
              const encrypted = Buffer.from(encryptedData.data, 'hex');
              
              const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
              let decrypted = decipher.update(encrypted);
              decrypted = Buffer.concat([decrypted, decipher.final()]);
              
              const standbyProfiles = JSON.parse(decrypted.toString('utf8'));
              profileToExport = standbyProfiles.find((p) => p.profileId === params.profileId);
            } catch (error) {
              console.error('Error decrypting standby profiles:', error);
            }
          }
          
          // If not found in standby, get from current profile
          if (!profileToExport) {
            const currentProfileRow = db.prepare(`
              SELECT csetting_value FROM csettings WHERE csetting_name = ?
            `).get('online_profile');
            if (currentProfileRow) {
              profileToExport = JSON.parse(currentProfileRow.csetting_value);
            }
          }
        } else {
          // Get from standby profiles
          const standbyProfilesRow = db.prepare(`
            SELECT csetting_value FROM csettings WHERE csetting_name = ?
          `).get('online_standby_profiles');
          
          if (standbyProfilesRow) {
            try {
              const encryptedData = JSON.parse(standbyProfilesRow.csetting_value);
              const iv = Buffer.from(encryptedData.iv, 'hex');
              const encrypted = Buffer.from(encryptedData.data, 'hex');
              
              const decipher = crypto.createDecipheriv('aes-256-cbc', keyguardKey, iv);
              let decrypted = decipher.update(encrypted);
              decrypted = Buffer.concat([decrypted, decipher.final()]);
              
              const standbyProfiles = JSON.parse(decrypted.toString('utf8'));
              profileToExport = standbyProfiles.find((p) => p.profileId === params.profileId);
            } catch (error) {
              console.error('Error decrypting standby profiles:', error);
            }
          }
        }
        
        if (!profileToExport) {
          return { success: false, error: 'Profile not found' };
        }
        
        // If filePath not provided, show dialog
        if (!filePath) {
          const result = await dialog.showSaveDialog({
            title: 'Export Profile Backup',
            defaultPath: `rhtools-profile-${profileToExport.username || 'backup'}.json`,
            filters: [
              { name: 'JSON Files', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          });
          
          if (result.canceled) {
            return { success: false, error: 'Export cancelled' };
          }
          
          filePath = result.filePath;
        }
      } else if (params.profile) {
        // Legacy format: profile, password
        profileToExport = params.profile;
        password = params.password;
        
        // Show save dialog
        const result = await dialog.showSaveDialog({
          title: 'Export Profile Backup',
          defaultPath: 'rhtools-profile-backup.json',
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        
        if (result.canceled) {
          return { success: false, error: 'Export cancelled' };
        }
        
        filePath = result.filePath;
      } else {
        return { success: false, error: 'Invalid parameters' };
      }
      
      if (!profileToExport || !password || !filePath) {
        return { success: false, error: 'Missing required parameters' };
      }
      
      // Derive key from password using PBKDF2
      const salt = crypto.randomBytes(32);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Encrypt profile
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      const profileJson = JSON.stringify(profileToExport);
      let encrypted = cipher.update(profileJson, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      const exportData = {
        version: 1,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        data: encrypted.toString('hex')
      };
      
      // Write to file
      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
      
      return { success: true };
    } catch (error) {
      console.error('Error exporting profile:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export keypair with password-based encryption
   * Channel: online:keypair:export
   */
  ipcMain.handle('online:keypair:export', async (event, { keypair, password }) => {
    try {
      const crypto = require('crypto');
      const { dialog } = require('electron');
      
      // Derive encryption key from password using PBKDF2
      const salt = crypto.randomBytes(32);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Encrypt keypair data
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(JSON.stringify(keypair), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Create export data structure
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        type: 'keypair',
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        encrypted: encrypted
      };
      
      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Keypair',
        defaultPath: `rhtools-keypair-${keypair.type}-${Date.now()}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result.canceled) {
        return { success: false, error: 'Export cancelled' };
      }
      
      // Write to file
      const fs = require('fs');
      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
      
      return { success: true };
    } catch (error) {
      console.error('Error exporting keypair:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Import keypair with password-based decryption
   * Channel: online:keypair:import
   */
  ipcMain.handle('online:keypair:import', async (event, { encryptedData, password }) => {
    try {
      const crypto = require('crypto');
      
      // Parse export data
      const exportData = JSON.parse(encryptedData);
      
      if (exportData.version !== '1.0') {
        return { success: false, error: 'Unsupported export format version' };
      }
      
      // Derive decryption key from password using PBKDF2
      const salt = Buffer.from(exportData.salt, 'hex');
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      
      // Decrypt keypair data
      const iv = Buffer.from(exportData.iv, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(exportData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const keypair = JSON.parse(decrypted);
      
      return { success: true, keypair };
    } catch (error) {
      console.error('Error importing keypair:', error);
      return { success: false, error: error.message || 'Invalid password or file format' };
    }
  });

  console.log('IPC handlers registered successfully');
}

// Helper function to sanitize file names
function sanitizeFileName(fileName) {
  if (!fileName) return null;
  
  // Only allow alphanumeric characters, hyphens, and underscores
  const sanitized = fileName.replace(/[^a-zA-Z0-9\-_]/g, '_');
  
  // Ensure it's not empty and not just underscores
  if (sanitized.length === 0 || sanitized.match(/^_+$/)) {
    return null;
  }
  
  return sanitized;
}

module.exports = { registerDatabaseHandlers };


