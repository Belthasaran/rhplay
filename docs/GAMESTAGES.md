GAMESTAGES
  Database records of the gamestages table in the rhdata.db
  Manually created records (sometimes with the help of tools) used
  to record details about the stages in a game

LEVEL DESCRIPTION RECORDS
-----------------------------
-stage_uuid=stage uuid
-levelnumber=Lunar magic level number
-levelname
-versions
-submapid=Optional Submap ID
-translevel_13bf=Translevel number (Calculated from levelnumber)
-tile_x=overworld tile X coordinate
-tile_y=overworld tile Y coordinate
-tile_value=overworld tile value
-requisites=Requisite patches to pick level
-playable=1 or 0 (Yes or no)
-rando=1 or 0 (Yes or no: Level suitable to be picked for random runs)
-difficulty=Difficulty 0 to 10. Below 1 is non-playable.  Above 7 is non-playable.
Kaizo beginner is 3, w/simple tutorial levels at 2. 5 is Master; 6 is Grandmaster; 7 is TAS-Only.
-mainexit=1 or 0 (Yes or no: Level has a main exit or goal)
-keyhole=1 or 0 (Has a keyhole exit or 2nd goal)
-credits=1 or 0 (Credits-onyl level)
-ghouse=1 or 0 (Ghost-house level)
-spalace=1 or 0 (Switch palace)
-castle=1 or 0 (Castle level)
-boss=1 or 0 (Boss level)
-secret=1 or 0 (Secret: Hide level name)
-troll=1 or 0 (Troll level)
-final=1 or 0 (Final or end game level of a hack)
-lock=1 or 0 (Lock: Prevent manually choosing the level)
-playlevel_patch_code=text (Name of the patchcode used for level selection)
-excluded_patchcodes=text (Patchcodes or tags incompatible with this level)
-rhpakuuid=uuid (UUID of a loaded RHPAK file that imported this stage record)
-extradescription=Human-readable extra notes about the level
-water=1 or 0 (Is a water level)

stage_uuid,gameid,levelnumber,levelname,versions,submapid,translevel_13bf,tile_x,tile_y,tile_value,
requisites,playable,rando,difficulty,mainexit,keyhole,credits,ghouse,spalace,castle,boss,secret,troll,final,created_at,updated_at,lock,playlevel_patch_code,excluded_patchcodes,rhpakuuid,extradescription,water




