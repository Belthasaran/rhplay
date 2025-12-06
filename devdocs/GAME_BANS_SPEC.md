

Create an elecron/gameversion-banmanager.js  to complement our existing  electron/database-manager.js

This script is to manage a set of special banlists based on "gameid" or other match criteria with a set of sections that gameversions will be banned from.

This should also provide quick functions or methods to be used elsewhere in the code, for example
  isGameBanned(gameid, action)     returning Yes if a given gameid is covered by a ban affecting the chosen action.     such as isGameBanned('1234', 'image_preview')
  or  getBannedList('image_preview')  to return a list of gameids in our gameversions table affected
  by bans.

The targets of our game bans may be listed on various criteria, but every gameid in our gameversions
table will have a not banned or banned status, which may be different for each kind of sense.
(The sense being different types of actions that may be performed on a game in the app,
and whether those actions are going to be allowed on that gameid.)

The system should support manually entering bans in a JSON structure within the gameversion-banmanager itself, and these bans will always be active when both active attribute is set to 1 and also the starting_at is either null, or the starting_at is less than the current timestamp.  And they apply when the sense of the ban matches the action being checked against.

I want to create a database migration adding a  gameversion_banlist  table  to the rhdata.db
This table will be for dynamic gameid bans which are not permanently hardcoded in the banmanger.


The data attributes for both the database and hardwired tables should be:
    -  banuuid -  unique UUID for the database.  Not to be required for bans hardwired in the gameid-banmanager.js table.
    -  gameid - Text column; if the match is based on gameid, then this column matches the gameid.
    -  match_column - Text column indicating which field is matched (Example: gameid, gvuuid, author, tags, url)
	-  match_pattern - Text column indicating the match pattern: such as an exact string, comma-separated string list, substring, or regex.
	    Match patterns should look like this  "a,b,c,d"  or  "exact:text here"   or "substring:text here"
		   or "regex:/^regex here/"  matches should be case-insensitive
    -  sense   -  Comma-separated string listing senses, that can include for example
"image_title,image_preview,image_show_soft,image_show_hard,check_random,run_random_game,run_random_stage,run_pick_game,run_pick_stage,details_stages_soft,details_stages_hard,details_soft,details_hard,list_title,list_any,start_patchplus,start_multi,start_patchplus,start_single"

    - required_acknowledgments - text - Comma-separated list of required acknowledgments to access the game for "soft" senses.  The user is to be warned "Some elements of this game are banned from default usage in the app, but you can certify you are of legal age above 18 and confirm warnings:"
	These are content warning advisories which must be acknowledged.  Each one can optionally be suffixed by a "*"  which means that manual acknowledgment is required every time, even if the user's preference is to show without acknowledgement.  Some acknowledgments can be saved for convenience, but if the ban contains a "*", then confirmation is always required for soft sense bans.
	   Elements that can be used in required_acknowledgments
         - Photosensitivity_Triggers, Suggestive_Content, Crude_Content_or_Language, Violence, Mature_Content, Sexual_Content

More record fields:  
    - starting_at   - An optional timestamp string when it becomes active at, default null
    - reason   - Text string
    - warningtext   - Text string
    - sequence_no - Int banlist check order amongst entries from the same source.  Database or hardwired.  Hardwired entries are always evaluated before database entries.
    - active - Int 1 or 0  boolean state whether the entry is effective.
	- image_title - 1 or 0, computed column based on sense - Do not display Title image or thumbnail image for game in list views (does not block viewing images by opening gallery in game details)
	- image_preview - 1 or 0, computed column based on sense - Do not display previews of game's images
	- image_show_hard - 1 or 0, computed column based on sense - Deny access to view game's image gallery
	- image_show_soft - 1 or 0, computed column based on sense - Warn before showing game's image gallery.
	- check_random - 1 or 0, computed column based on sense - Make Select>Check random function exclude game from selection
	- run_random_game - 1 or 0, computed column based on sense - Make random game filters in Prepare Run exclude this gameversion
	- run_random_stage - 1 or 0, computed column based on sense - Make random game stage filters in Prepare Run exclude all stages from this game
	- run_pick_game - 1 or 0, computed column based on sense - Make manually adding this game with Add to Run button disallowed. The Add to Run function should also fail with an error message if this game is checked.
	- run_pick_stage - 1 or 0, computed column based on sense - Prevent the user from adding any individual stages of this game in the View Game Stages dialog.
	- details_stages_soft - 1 or 0, computed column based on sense  - Clicking view game stages on this game will require confirming a warning message.
	- details_stages_hard - 1 or 0, computed column based on sense - Clicking view game stages on this game will display an alert that the game is blocked from this app function.
	- details_soft - 1 or 0, computed column based on sense - Selecting just this game in the main view, and its details will be hidden behind a warning panel  
	- details_hard - 1 or 0, computed column based on sense - Selecting just this game in main view, then its details pages will be blocked from display and cannot be overridden.
	- list_title - 1 or 0, computed column based on sense - Text of the game's title will display as <censored>  in the main game's list
	- list_any - 1 or 0, computed column based on sense - The game will not show up in the main list view at all
	- start_multi - 1 or 0, computed column based on sense - Prevents selecting the game with other games when clicking the "Start" or "+Patch" button.   The game can only be started individually.
	- start_patchplus - 1 or 0, computed column based on sense -  Prevents selecting the game when using the +Patch function.
	- start_single - 1 or 0, computed column based on sense -  Prevents using the "Start" button when the game is selected at all.   This also is to block access to test stages on the matching games' gameid from the Select Game Stage dialog in view mode.

   The sense strings should also be able to contain wildcards, such as "run_random_*"

   It should be allowed to have multiple ban entries for a gameid which may match on other columns such as author,  and the active entry with the lowest sequence_no to match matches first.  Multiple entries of the same sequence_no may match in any order (unpredictable).

   The columns found in sense are always to be set to 1, and columns not matched by sense are always to be set to 0.
   The senses are functions that matching gameversions are to be blocked from within the application.
   "soft" senses are to display a warning and confirmation message to the user  about the Gameid soft block  for accessing those features  with the warningtext  shown or fallback to a default "The action (used sense) is deemed hazardous or sensitive on this specific game.  Are you sure you want to continue?".

   Any senses which don't have "soft" in the name are hard senses, and are to block the action entirely.


