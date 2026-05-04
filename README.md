# Purpose of this Program
This program assists with managing and launching SMW Romhack files by automating download, patching, local file management.

A searchable cache database is provided, allowing any hack in the database to be automatically downloaded, patched and loaded into RetroArch or consoles on demand  (Currently only USB2SNES with the CrowdControl app running is supported.  Launching games on emulators without a USB2SNES server has not yet been implemented.) - by searching and specifying the patch number.

The database collected allows automating operations such as "Choose and launch a random game from the collection based on criteria X, Y, and Z"

**Key Features:**
- **Source code, Linux-first releases**: There are both Linux and Windows builds, but development and testing is primarily on Linux. Windows support is secondary.  All project source code is included with release packages, so you can review it to ensure software is to your liking.
- **Advanced Search & Filtering**: Powerful search and filtering system to find hacks by name, author, tags, difficulty, and more from a database of thousands of SMW romhacks
- **One-Click Game Launch**: Select any game from the database and launch it to your SNES hardware (using USB SD2SNES) in seconds with automatic patching, uploading, and booting
- **First Launch Automatic Install/Database Provisioning**: If your databases are not ready to use in Windows %APPDATA%\\rhtools\\rhdata.db %APPDATA\\rhtools\\patchbin.db or Linux ~/.config/rhtools/  etc.. the program on first now launches a helper to walk you through downloading romhack cache data and building local databases.
- **Save Local Research notes and your own Personal review of games based on the following available  star ratings (Planned future work for Publishing and aggregating crowdsourced star ratings and comments on romhacks from other users; with rated game rankings on dimensions based on player skill verified using USB-Monitored challenge runs)**:
- Current rating dimensions you can currently rate games in the user interface against the following dimensions:
    - My Overall rating (Choose between 0 and 5 stars)
    - My Difficulty (Opinion on correct game difficulty), My skill (at time of rating), My skill (at time I beat),
    - Recommendation - do I recommend the game for others
    - Importance (Special significance of the game, such as Kaizo SMW)
    - Technical Quality - To what degree is the game objectively functional and free of all major bugs/glitches such as crashes, freezes, soft locks, or serious display issues including flashing, sputtering, tearing, color bleeding, audible noise or visual sprite garbage.  This includes
technical features not working as they appear intended to work, but not loopholes or cheese in general (which might affect Difficulty quality or Gameplay Design).
    - Gameplay Design (Enjoyable gameplay, interesting mechanics, free of obstacles that impede player for reasons other than skill - e.g., blind jumps)
    - Design Quality: Player Fairness (Star rating for progression barriers - whether in the game rated: progression barriers are highly related to player skill level, and not artificial imposed barriers unrelated to player skill at SMW. A rating of 5 stars indicates all challenges are reasonable, and a player at the general skill level the game is intended for would spend 99% of their gameplay time tackling challenges of skill, and not being impeded by obstacles or sequence of challenges that a human of any skill level would usually fail at least once - e.g., hazards or trolls which cannot be anticipated, or very long runs of obstacles between checkpoints)
    - Design Quality: Challenge Quality Rating (Whether players actually need valid skill to complete this, or the game has mostly challenges where a player at the defined skill level simply wins with enough trial and error. A score of 0 suggests the hack contains many trial and error challenges that any player with enough time could clear. A score of 5 indicates that only by developing meaningful skills at SMW gameplay, native SMW mechanics, or understanding of SMW, can the player overcome these challenges. High challenge quality means there is high transferability of skills required to beat the hack to SMW in general)
    - Originality / Creativity (The game is significantly unique and interesting)
    - Design Quality: Visual Aesthetics (Overworld and levels well designed visually - free of floating muncher stacks, naked pipes, etc.)
    - Story (Does the game have a compelling or interesting story?)
    - Soundtrack and Graphics (Quality of soundtrack and graphics presentation)


- **Additional Patches/Burned-In Cheats System with built-in patch presets** - Automatically add specified patches burned into ROM: including Game Genie codes and ASAR patch templates.  Built-in patch templates such as Start every level Cape, No Yoshi Ditch, One-Hit KO, "Infinite Lives" (Useful for Kaizo Mario World,  Some games or patch/addons may have limited compatibility with each other)
- **Automated Challenge Runs** (ALPHA): Create timed challenge runs with multiple random games or stages, complete with win conditions, rollover time mechanics, and real-time timer overlays for streaming
- **USB2SNES Auto-Completion**: Revolutionary USB polling system that connects to SD2SNES flash carts (EXPERIMENTAL); Monitors the progress of your challenge runs to verify your actual gameplay: automatically detects when you complete a challenge by monitoring SNES memory, advancing to the next challenge and launching it automatically - no manual button presses needed
- **Twitch Predictions Integration** (NEW Experimental system): Seamlessly integrate with Twitch to create, manage, and resolve predictions for your challenge runs - supports Yes/No, Time Range, and Whole Challenge prediction types with automatic resolution
- **Live Cheats System**: Using the USB port of USB2SNES: You can make certain live tweaks for your challenges, such as Turn current level into water level, Warp to a different level, Grant Star or Cape.  OR create additional challenges, such as Poll and reduce game timer.

This is a sample release.
This program is incomplete and a work in progress.

![Rhplay Main window](/img/rhtools-rhplay-ss0.png "Main Window")
![Rhplay Settings](/img/rhtools-rhplay-ss1.png "Settings Window")

# Running the program
   This program is based on Python 3.10.x.  NodeJS, and Electron
   *  Please install the pre-requisites Including: Flips, Asar,
      and a Legally-acquired original SMW rom as discussed in the Section Pre-requisites.
 Download
    Option to Download FLIPS and such from:
    Github release page:

      https://github.com/Belthasaran/rhplay/releases

The release and databases which record information about games, such as the list of stage names, descriptions, authors, tags, patch data, etc, is being mirrored to ArDrive - an [arweave](https://arweave.org/) backed system which provides for long-term data preservation.

This contains everything you need to get up and running, EXCEPT we do not distribute any original Mario world ROM nor standaloen games, only cached patch data and metadata. See the Pre-requisites section for more information.

A Manifest pointed to 0.1.9beta Source of this release and game description databases is mirrored to the Permaweb at:
  Data Tx Id: DK1pEOvS1Ztc18sEubvm4F7yPrql_OQU7G7GA7rs2hA
  Metadata Tx Id: MJDsk-3v8ATxOgRWDV7Fk35FcnFxwZjyqIKIDtQbjZk
  ArNS Name: rhplay_smwresource

# Current Features Detail

 - Quick launch automation feature for "ROM Games" (SMW Hacks) -  Once the entire ~2GB database file is provisioned: this program lets you choose a random SMW hack from the local database; so long as you provided your own SMW ROM to use - you can quickly automate the process of loading any random game; uploading it to your SNES over the SD2SNES USB port, and boot the game in a few seconds with a single click.  (No need to get out of your chair and shuffle memory cards).  Perhaps i'm just lazy, but this was and always should be the primary use case for the program - streamlining the process for quicker and less tedious access to review and study/analyze massive SMW game collections.   Looking at many SMW romhacks a little bit; finding, downloading, patching, and launching hack manually is 4 steps - that wastes 5 or 6 minutes per hack: making the process of research impractical. Automation and point-and-click launch from a games listing is desired!

 - Attempts to provision databases on first launch (rhdata.db, patchbin.db, clientdata.db, etc)

 - USB2SNES Game uploads and launches - Requires working USB2SNES on a computer connected to a SD2SNES.  You will have to configure the websocket URL to connect to manually if your system does not use the default of ws://localhost:64213  (as expplained in other sections of this document).   In my testing this is usually a physical computer while my copy of this program runs inside a Linux virtual machine.   You can connect to a remote computer using SSH and forward a port from the local machine to the remote computer.   For example: Forward 64213 to localhost:64213 on the destination machine through your SSH client.   Even Windows11 provides an OpenSSH Feature you can turn on from Windows features these days.   This app also supports configuring a SOCKS proxy for forwarding the USB2SNES connection: If you wish to go that route.
The app has incomplete "Embedded usb server" settings which are clearly labelled as does not work, and don't try them yet.

 - SMW Randomizer features: From the "Select Menu" you can click Check Random to pick one random game and quickly start it.

 - SMW Game+Stage Randomizer: You can prepare a "Challenge run" that includes multiple random SMW Games or random SMW stages in sequence.  Random SMW game is any game in the database that contains BPS patching instructions  (A few gameids or gameversions might not due to various issues).

 - Random Stage for Stage randomizer challenge run is Limited to gamestages manually added to the gamestages database with
a Defined "Play my Level" patch preset.  Such as the "2lvno, 1lvno, or Storks level selector"   These special patch presets
are used to dynamically patch a SMW Romhack, so that when you enter the game: instead of playing that game normally - you enter directly to a randomly selected level id from  our database of translevel level ID numbers for that game.   This only works on certain games currently, and different SMW games require different patches,   therefore your random selection for Stage Randomizer is Limited to games that had  specific stage Id numbers with a patch preset manually entered into the database  Indicating which patches are required for a specific game.   E.G.  For "Storks Apes and Crocodiles" -   I wrote a very specific patch for level selection which applies to no other SMW hack.    Additional patches and gamestages records could be contributed  using the CSV format, for example:


   `"stage_uuid","gameid","levelnumber","levelname","versions","submapid","translevel_13bf","tile_x","tile_y","tile_value","requisites","playable","rando","difficulty","mainexit","keyhole","credits","ghouse","spalace","castle","water","boss","secret","troll","final","lock","playlevel_patch_code","excluded_patchcodes","stagetags","rhpakuuid","extradescription"`
   `"9c77664a3c2d274fdbd7582abaa9647e","18612","126","Australian Airways","*","","4A","","","","","1","1","3","1","0","0","0","0","0","0","0","0","0","0","0","1lvno","","cape","",""`
   `"e19982aa50a3d374d64da4caf2dcfdad","16059","002","The River Dyx","*","","02","","","","pall,infliv","1","1","5","1","0","0","0","0","0","0","0","0","0","0","0","1lvno","","","",""`
   `"","17441","101","CHUCK CITY","*","","25","","","","","1","1","1","1","0","0","0","0","0","0","0","0","0","0","0","","","","",""`

And the ASAR (assembly script template) format for gamestage patchcodes which requires either a two-byte zero-padded level number (glevelnum) such as $001, $02A, $103, etc,  OR a  levelnumber with leading zeros stripped such as  $2A format  glevelnum_s.  Limitations:

 - 2lvno - Patch preset works for most games, But non-retry patch games lose midway support.  Some retry-patch games work p
erfectly.   Some retry-patch games do not re-enter the player at the same level.   Some games crash.
 - 1lvno - Patch preset for level selector has the limitaiton that since it uses UberASM;  Many Hack-specific custom ASMs are disabled. Some games crash.

Neither patch preset works for all games, and they just represent the best I have been able to do so far.

 - Databases include a list of many SMW "Romgames"

 - Search and Filtering options to find games; Details such as name, Author, Download location, Web link to the game's SMWC page for example, manual download links for BPS; file checksums, etc.

 - Options to select a game and click "Start" to quickly automate the process of gathering BPS patch files and applying patches to game file supplied by the user (automate process of using the ROM you already own with flips to play a modded/tweaked game)

 - USB2SNES Websocket server support; so you can click Start, then UPLOAD TO SNES to automatically upload files to your SNES equipped with Sd2SNES using the USB port.

 - Search and Filtering options to quickly find what you are looking for.

 - Option to check multiple items (Multi-select)  and create a batch of files to quickly patch and upload to your SNES as a bulk staging operation.

 - "My SNES Files" button to list games loadable from the /work directory on your SD2SNES' SD card.

 - Plus Patch button to create ADDITIONAL "Patch preset definitions" which you can apply to certain Batches, Game stages, or games.   For example: "CrowdControl-2023 enablement IPS patch"  for certain SMW hacks.     Use the +Patch button  to automatically load a copy of SMW on your SNES  apply the ROMHACK,  and any of the custom additional patches you want.

Your patching options for +Patch are to include:

 - "Game genie codes" - Decoded and used to create an ASAR script which burns the game genie code in to your game for quicker access.

 - ASAR script.  ASAR script template - You can write a script template in assembly to be patched on top of your game.  This allows flexible patching of complex assembly snippets such as  "Warp player to certain level on overworld level entry";  Storks random levl selector use case, etc.   "pall" - Set all Switch Palaces, etc.

 - IPS/BPS files.   IPS files are more generic;  BPS files are specific to a certain base patch, generally.

# Online Profiles

 - Matter for future work for Online support.  The function is not yet finished.  Allows (require) creation of an online user profile.  This is protected by a Master password function called Keyguard configured on first time startup.

  - Keyguard will encrypt your profile data inside the program to help protect it,  especially in high security mode.
For example: If you decide to use Twitch integration features, then security tokens issued when you connect your account should be encrypted and protected by Keyguard.

# Challenge Run Feature

  - Allows selecting random SMW games   and/or   random SMW Game stages (Only for those games which currently have a detailed stage list specified in the database  and a "Play my level" System patch preset in place that defines How to modify the game to load player into a specific stage)

  - Optional Stage Limits, Game Limits filtering  games based on various criteria.

  - Optional challenge overlay feature for generating a HTML overlay displaying run timer during challenge runs: runview.html

  - Optional Win conditions: such as Time limit for run.  Time limit per challenge item.   Optional Rollover time which means that if you finish a challenge item before the time limit - you can accumulate some amount of rollover time and spend that time on other challenges.

  - Optional built-in web server (utility process) that can help serve the overlay locally or remotely for easy OBS Access - http://localhost:2599/runview.html

  - **Twitch Predictions Integration**: Full-featured integration with Twitch's Prediction API for challenge runs. Supports three prediction modes:
    - **Individual Item (Current)**: Create predictions for the current challenge item as you play
    - **Individual Item (Next)**: Create predictions for the next challenge item before you start it
    - **Whole Challenge**: Create a single prediction for the entire challenge run
    - Supports **Yes/No** predictions (e.g., "Will the player complete this challenge?")
    - Supports **Time Range** predictions (e.g., "How long will this challenge take?") with configurable ranges based on win rules, rollover time, and grace periods
    - Supports **Whole Challenge** predictions (e.g., "How many challenges will be completed?")
    - Automatic prediction creation, locking, and resolution based on challenge completion
    - Manual control options for locking, canceling, and reopening predictions
    - Automatic conflict detection and resolution when enabling predictions
    - Prediction state persistence across application restarts
    - Configurable prediction windows, delays, and outcome options
    - Status messages and warnings for prediction management

  - **USB Polling Auto-Completion**: Revolutionary feature that automatically detects challenge completion by polling SNES memory addresses:
    - Monitors game state (animation, level status, timers, switches, etc.) every second
    - Automatically detects goal events (level completion, boss defeat, keyhole entry, switch activation, etc.)
    - Automatically advances to the next challenge when completion is detected
    - Automatically launches the next challenge's game file
    - Visual feedback with color-coded button status (blue = good performance, red = slow, orange = wrong game file)
    - Condition A system ensures stable game state before enabling goal detection
    - Respects pause/unpause and run lifecycle
    - Only polls when run is active and not paused
    - Auto-reconnects to USB2SNES if connection is lost
    - Verifies correct game file is loaded before polling

## NEW Initial Release

This program has been reconstructed from Python into NodeJS and Electron with a complete replacement of the Graphical User Interface.

Initial  release set
- RHTools-0.1.0-beta.AppImage - Linux standalone binary

- RHTools-0.1.0-beta-portable.exe - Windows standalone binary

Note:  This software is for experimental purposes and testing only and not production use.

The program comes with no warranty nor usage rights, and I recommend running it in a secure isolated environment: such as a dedicated  Virtual Machine.   By running any test software inside a virtual machine you help protect your host computer system from any crashes, stability, or security issues in the software.

## Requirements before Running

Installation Requirements:

A.  USB2SNES  functionality requires having a  USB connection to  your SNES already established, and you must have a USB2SNES server accessible to the local host.     By default this is expected to be available on port 64213.     This is configured in the  USB2SNES websocket URL  setting after opening the application.


A. USB2SNES functionality requires having a USB connection to your SNES already established, and you must have a USB2SNES server accessible to the local host. By default this is expected to be available on port 64213. This is configured in the USB2SNES websocket URL setting after opening the application.

If you use the CrowdControl app from [crowdcontrol.live](https://crowdcontrol.live/)  while playing a USB2SNES enabled game with the SNES hardware connected: Crowdcontrol currently has a usb2snes server that listen on ws://localhost:64213 -  As soon as you select  Super Mario World  in the CrowdControl app  with the USB2SNES option, and then provide a rom within the CrowdControl app.   The app provides a usb2snes host server.

At this time; the CrowdControl app's usb2snes server is the only Usb2snes server app tested.  Your other options such as QUSB2Snes do not necessarily work with this tool.   QUSB2SNES contains differences from the original usb2snes server which might cause problems.

There can only be one USB2SNES server running on your PC at a time  that controls the  SNES over a USB port. The USB port is exclusive access.   This is not an issue if you do not run both apps at the same time, but  We do want to be able to run both apps at the same time, so we can simply have our app always running and not conflict with any CrowdControl session the user wishes to run..

Therefore, we make the decision not to include a Usb2SNES server with this app and simply recommend that you should use CrowdControl's usb2snes server.   In this case:  you must use the usb2snes server provided by CrowdControl in this case, at this time -  select the game Super Mario World, choose a ROM file and USB2SNES connection,  but do not start a CrowdControl session while using the functions of this app..   You MIGHT crash your SNES or cause stability issues if you try to have both a CrowdControl session and this program active at the same time -- CrowdControl effects, and actions you take in this program's effects may conflict -  Make sure to Pause or End any CC session using your SNES hardware before uploading files from this utility.   

And you need to edit the  USB2SNES options in  the "Open Settings"  dialog.
                      The default websocket url of   ws://localhost:64213    specifies the default port number.

If your Computer running this application is a Virtual Machine or separate computer from your machine running the usb2snes server:   You can open a SSH connection from that computer and  remotely forward the respective port backwards   To provide remote access to your websocket server.

 - `ssh   <Host IP>    -R  64213:127.0.0.1:64213`

In general ws://<remote ip>:64213  does not work as a Websocket URL, because
most usb2snes servers accept connections from localhost only.

The ssh command and ssh server are standard features on most Linux and MacOS systems, and installable features on Windows 10 and newer.
You can also use a SSH client such as  MobaXterm to establish the reverse tunnel
over SSH.   You have to keep a tunnel or forwarder up and running the whole
time in order to use a Usb2snes server on a remote computer.


B. You will currently need to install your  clientsettings.db  rhdata.db and patchbin.db  files in  %APPDATA%\rhtools\
manually.      The database files are Not included with standalone binary.  You have to install them.
The release Executable now has a built-in database provisioning assistant which will help you.   Run the RHplay program for instructions if necessary.

C. You must install a clean base ROM for all patching.    Please place  your base  .sfc file  (Vanilla SMW)  to   %APPDATA%\rhtools\smw.sfc   
The file data must match these specifications to be accepted:   Filename: smw.sfc
SHA256 checksum:  0838e531fe22c077528febe14cb3ff7c492f1f5fa8de354192bdff7137c27f5b
SHA1 checksum: 6b47bb75d16514b6a476aa0c73a683a2a4c18765
MD5 checksum: cdd3c8c37322978ca8669b34bc89c804

** The file is required to load any patches or games based on SMW, **
** You must supply your own ROM data.   We cannot provide you with copies of any ROMs or actual games. **
** This program only helps you  automate the process of retrieving, caching and applying publicly available patches based on games you must already possess and own. **
** The results or outputs of this program are solely for your own personal, private study and experimentation on the workings of SMW. **
** You must not provide others copies of complete games, patched .SFC files, or ROM data, without license from the respective  publisher, either. **

Additional programs/utilities you currently need installed:

D.  Flips  - Please copy your  flips.exe to  %APPDATA%\rhtools\flips.exe
https://github.com/Alcaro/Flips/releases

E. Asar  - Please copy your asar.exe  binary from asar-1.91 to %APPDATA%\rhtools\asar.exe
https://github.com/RPGHacker/asar/releases

F. UberAsmTool21  (Version 2.1) - - Please extract all the files in your UberAsmTool21.zip  to a subdirectory of %APPDATA%\rhtools\,   so for example  the path to UberASMTool will be  %APPDATA%\rhtools\uberasmtool.exe
https://www.smwcentral.net/?p=section&a=details&id=39036

You should be prompted within the Settings menu of the program to provide the paths to these programs.

# Older Release Information

Everything beyond this pointg is mainly historical and  applied to the Python rhtools GUI,
which has now been superceded.

### Base ROM

This program requires a legally-acquired base rom to use.
This file should be vanilla SMW.

Name the file smw.sfc  and Place the file in the same folder you
run the program from

### FLIPS and ASAR

- You need the floating IPS Patcher flips And ASAR 1.71 installed.

- Please use the see the flips-rhtool package from
      https://github.com/Belthasaran/rhtools/releases

  The flips and asar binaries must be placed in either a specific folder or the present working directory.

  The release zip files include all source code and are intended to be exracted into the C:\snesgaming folder.

- Those products are both under the GNU GPL.  For your convenience: This website contains
a copy of them:  Download  flips-rhtool-0.1_2023.tar.gz

If you are a Windows Subsystem for Linux user,  then just use 7-zip to extract the file and its subfolders in C:\SNESGAMING

Linux users can extract the archive and then copy  bin/flips and bin/asar   To  /usr/local/bin.
  tar zxvf flips-rhtool-0.1_2023.tar.gz
  sudo cp bin/flips /usr/local/bin
  sudo cp bin/asar /usr/local/bin

  Create a rhtools_options.dat  containing the  WebSocket address of your Qusb2SNES computer

  For example:

    {"launcher1": "./llaunch_rand.sh %file", "launcher2": "default", "wsaddress" : "ws://windowsPC.local:8080"}

  Where windowsPC.local is the name of the Windows PC running QUSB2snes.
  (Note that QUSB2snes and Windows Firewall need to be configured to accept connections on that port from the computer running the RHTools console)


### Linux

This program is written on Linux to run on Linux.

The following steps are for Windows users.

Windows users should still be able to run this program:
    * First: install Windows Subsystem for Linux (see below for details)
    * Next: download and install MobaXterm

### Setup for Windows Users

Windows users: Please create a directory named C:\SNESGAMING
and put these scripts in a folder named RHTOOLS below C:\SNESGAMING

When you install ASAR and FLIPS as required,  create a
folder called C:\SNESGAMING\bin   then copy The linux versions of
asar and flips to that bin folder.

### Windows Subsystem for Linux

I recommend the following article:
https://ubuntu.com/tutorials/install-ubuntu-on-wsl2-on-windows-10#1-overview

In short - the first steps are:

  wsl --set-default-version 2

  wsl install -d ubuntu

After you have installed your environment,  Launch  MobaXterm, 
choose "Start Local Terminal" and double click the WSL-Ubuntu user Session.

If there is no WSL-Ubuntu User session, then  Right click "User Sessions",
pick "New Session",  then Choose WSL on the far Right, and
change Distribution to "Ubuntu",  then click OK.

Open a  Ubuntu-WSL Tab

then

    cd /mnt/c/snesgaming/rhtools

    python3 gui.py


### PIP Modules:
   Please install PIP modules   before running 

pip3 install -r requirements.txt

Please install:

    pip3 install ipfshttpclient

    pip3 install cryptography

    pip3 install requests

    pip3 install compress


    pip3 install aiofiles

    pip3 install websockets


### Database Maintenance


PROCEDURE TO ADD A HACK TO THE DATABASE:


To add hack with ID example1234

1. Create folders  zips/ hacks/

2.   create  hacks/example1234
     This should be a text file in JSON format.

The JSON file should contain Information which identifies the hack..

Starting with 0.4 you can use the 'python3 db_makehack.py uniqueid'  Utility to help create the JSON file.

Be prepared to answer these questions

    $ python3 db_makehack.py local_123456
    Hack name:test hack
    Enter author names:tester
    Description:this is just a test
    Length (example: "5 exits"), or unknown:2 exits
    Please choose type from above list: 1
    Is the hack a demo?  Yes or No: No
    Specify tags
    Enter a tag to add, or -tag to remove a tag, +add to create a new tag, list to display common tags, or done to accept: normal
    Selected tags = ['normal']
    Enter a tag to add, or -tag to remove a tag, +add to create a new tag, list to display common tags, or done to accept: done
    That done does not seem to be in the list of known tags -  Try +tag 
    Enter optional author URL (or leave blank): 
    Enter URL for information about the hack (or leave blank): 
    Enter direct URL to the raw Zip file (or leave blank): http://example.com/download/local123456.zip

EXAMPLE:

{
    "added": "2023-09-03", "author": "test", "authors": "test",
    "demo": "No", "description": "test", "id": "example1234",
    "length": "unknown", "name": "example hack", "rating": [ "0.0" ],
    "tags": [
        "traditional"
    ],
    "tags_href": "", "type": "Standard: Normal",
    "url": "https://example.com/info/smw_example",
    "name_href": "//dl.example.com/download/smw_example.zip",
    "author_href": "/?p=profile&id=example"
}


3.  Create   zips/example1234.zip

The .zip file should contain A file named example1234.bps   with the Patch data.
the Patch must be against the vanilla SMW game in BPS file format.

The filename is generally important, but it Must end with .bps, And there should
be only one BPS file within the .zip file.


4.  Run mkblob
     python3 mkblob.py  example1234

     The program mkblob will Automatically extract the ".zip" file and apply the patch.
     If the patching is successful, then the BPS blob will be saved to the blobs/ directory,
     And  hacks/example1234  will be updated to add Verification checksums, and
     a unique key for the blob.   The BPS will be compressed and encrypted for the purpose
     of verifying integrity when launching or using the patch later.

     Important Note: If you are intending to distribute the patch blob:
     The blob file is encrypted and unreadable without the key which is entered into hacks/example1234
     by mkblob -- running mkblob a second time would cause a loss of the previous key - Both files
     (or the database file) are required to use the patch blob.

     The output looks like:

     $ python3 mkblob.py example

example.bps
The patch was applied successfully!
::: {'added': '2023-09-03', 'author': 'test', 'authors': 'test', 'demo': 'No', 'description': 'test', 'id': 'example', 'length': 'unknown', 'name': 'example hack', 'rating': ['0.0'], 'tags': ['traditional'], 'tags_href': '', 'type': 'Standard: Normal', 'url': 'https://example.com/info/smw_example', 'name_href': '//dl.example.com/download/smw_example.zip', 'author_href': '/?p=profile&id=example', 'patch': 'patch/Rf_sNY6-VeRrbd3ehCVZ8r6qsJcsGOsg', 'pat_sha224': '07886ea9791a671581e7bd2e5bc36999bf9e1598838d5b7f505f173a', 'pat_sha1': '556ada885b72ba0c060d7a569a357501509c2b7a', 'pat_shake_128': 'Rf_sNY6-VeRrbd3ehCVZ8r6qsJcsGOsg', 'result_sha224': 'fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08', 'result_sha1': '6b47bb75d16514b6a476aa0c73a683a2a4c18765', 'result_shake1': '1SNFIbeimj0ck4t5ylWe6a80jqt9gYkL', 'rom': 'rom/example_1SNFIbeimj0ck4t5ylWe6a80jqt9gYkL.sfc', 'patchblob1_name': 'pblob_example_a45829efe5', 'patchblob1_key': 'dGRJUDJWc0txZXA2b2E5a0lxa1dQV2d1c2VQZWZ2aW14SU1MMzJFMWc1ND0=', 'patchblob1_sha224': 'a45829efe55990d404d9136207f9ded73793b9b9e761195baf2e3d31', 'romblob_salt': 'kyjCSqrKdeH3l4_t5gbcbQ==', 'romblob_name': 'rblob_example_f1fc80f5d9'}
rom/example_1SNFIbeimj0ck4t5ylWe6a80jqt9gYkL.sfc


    At this point the  hacks/example  File has Already been updated and is ready to add to the database.

5.      bash do_addhacks.sh
     This script will scan the  hacks/  directory  and attempt to add all hacks found in hacks/ to the database.

     NOTE:  If a hack by that same ID is already in the local database, then it will be removed and replaced with
     the items found in hacks/.   

     Assuming the direct download URL is populated and correct, then the game could presumably be added to the repository for display in the GUI and selection.

     The game ID numbers should be unique to each hack: no two different hacks should ever have the same level ID.
     Conflicting IDs result in the later entry being treated as a "new version" that replaces the old version's data.
     Suggestion: Do not use a numeric ID number unless the hack is on SMWC, and your ID number matches the hack's ID number on SMWc.

     Please use db_makehack.py <Unique ID>

     For SMW-Central hacks please use th SMWc ID number

     If you dont have an ID, then use  python3 tempid.py FILENAME

     Tempid.py will create a temporary local ID based on a timestamp and part of a file hash


# PSETS

  OPTIONAL STEP when recording hacks in Database ,   create a  patchblob bundle or pset.
    A pset is a .zip file containing many hacks sorted by Id prefix.
    Each pset Zip appears as an entry in psets.dat.

    This allows creating a series of zip files which contain thousands of patches,
and the correct .Zip file and patchblob can be automatically downloaded from a URL listed
in psets.dat

  For example  the following psets.dat entry describes a zipfile for hacks whose Id starts with "yy" or with "0":
       [ 
         {
             "hash": "blah blah",
             "ipfs": "blah blah",
             "key": "blobs/setpblob_pblob_yy_0.zip",
             "publicUrl": "https://example.com/setpblob_pblob_yy_0.zip"
         }
        ]

     The publicUrl and ipfs keys provided are means of downloading the bundle of patches.

     $ unzip -v setpblob_pblob_12_0.zip 
     Archive:  setpblob_pblob_12_0.zip
      Length   Method    Size  Cmpr    Date    Time   CRC-32   Name
     --------  ------  ------- ---- ---------- ----- --------  ----
      144784  Defl:X   144809   0% 09-25-2022 19:40 f25b70a5  pblob_12113_f9265e50c7
      195604  Defl:X   195634   0% 09-25-2022 19:41 671f7f23  pblob_12147_9769da55a4
      382336  Defl:X   382396   0% 09-25-2022 19:41 484c01d0  pblob_12161_d771eb4106
      443780  Defl:X   443850   0% 09-25-2022 19:41 e9fb1b6f  pblob_12162_b350b852de
      280112  Defl:X   280157   0% 09-25-2022 19:41 e8df416c  pblob_12310_f82fac72b5
      187952  Defl:X   187982   0% 09-25-2022 19:41 2ea40806  pblob_12691_6f8c3e795f
      360992  Defl:X   361052   0% 09-25-2022 19:41 f037e71f  pblob_12718_4722953c1f
      181840  Defl:X   181870   0% 09-25-2022 19:41 2cc49613  pblob_12725_e2df438cde
      355440  Defl:X   355495   0% 09-25-2022 19:41 9b012201  pblob_12758_cf7edded64
       31980  Stored    31980   0% 09-25-2022 19:41 10b6d8b3  pblob_12794_5910f4da19
      356152  Defl:X   356207   0% 09-25-2022 19:41 02138bde  pblob_12810_b6d84ce128
      170576  Defl:X   170606   0% 09-25-2022 19:41 a23b70d6  pblob_12812_05b7bfe1d0
     1552124  Defl:X  1552364   0% 09-25-2022 19:41 042e4376  pblob_12826_bef1d64bc8
       40008  Defl:X    40018   0% 09-25-2022 19:41 65af08e3  pblob_12884_9924411293
      337380  Defl:X   337435   0% 09-25-2022 19:41 06fcc7c8  pblob_12916_3c3da10642
      425324  Defl:X   425389   0% 09-25-2022 19:41 4da45e40  pblob_12920_a2ded008d2
      269748  Defl:X   269793   0% 09-25-2022 19:41 b8bd4b02  pblob_12923_4a82423cd8
      400436  Defl:X   400501   0% 09-25-2022 19:41 e00a8a47  pblob_12947_09eb4fe759
       70428  Defl:X    70443   0% 09-25-2022 19:41 54265079  pblob_12979_581435c6df
    --------          -------  ---                            -------
     6186996          6187981   0%                            19 files

  
# Example Level loading Patch: Storks


Storks, Apes, and Crocodiles is a SMW hack.  This particular one has been assigned game id number: 27282.

The URL for more information about the game is at <A HREF="https://www.smwcentral.net/?p=section&a=details&id=27282" TARGET="_new" REL="nofollow">https://www.smwcentral.net/?p=section&a=details&id=27282</A>

In the game of Storks... I just wanted to be able to try playing any level number, not just level number 1.

after a few days with a debugger, I came up with this patch variant

```
; I just want to try playing levels in Storks other than Level 1...
;
; asar temp3.asm storks_copy2.sfc ; snes9x -conf snes9xb.conf storks_copy2.sfc
;  Found valid level numbers: #$01, #$02, #$03, #$04, #$05, #$06, #$07, #$09, #$0A, #$0B, #$0C, #$0D, #$0E, #$0F, #$10, #$11, #$12
!levelnumber = #$0F
org $85d856
    JSR Main ;jsr n n   +2 d85a  (length=3)
    BNE $3   ; len=2    (bne,       length=2) ;  bne n
    JMP $d8a5 ; len=3     (jmp $nnnn, length=3) ;  jmp n n   ; +3
org $85f8f0
Main:
    LDA !levelnumber
    STA $13bf
    CPX #$03
    BNE .etest
        LDA $0109
    RTS
    .etest:
    RTS
```

In order to make the local modification Which alters the game Storks to let me play any level usable in rhtools,  I edited asm1.py  to add  a condition to get_a_patch() for patch number 20,
then I added this function  get_c_patch(pid,chosenlid)

Finally, I add the following entry to pnums.dat

```
27282 20
```

And then log the Valid level ID numbers in log.txt

```
> 27282 2 20 2 1694519499 _ 0x0
> 27282 2 20 2 1694519499 _ 0x0
> 27282 3 20 3 1694519556 _ 0x0
> 27282 4 20 4 1694519572 _ 0x0
> 27282 5 20 5 1694519585 _ 0x0
> 27282 6 20 6 1694519601 _ 0x0
> 27282 7 20 7 1694519624 _ 0x0
> 27282 7 20 7 1694519637 _ 0x0
> 27282 8 20 8 1694519650 _ 0x0
> 27282 9 20 9 1694519664 _ 0x0
> 27282 A 20 10 1694519705 _ 0x0
> 27282 B 20 11 1694519721 _ 0x0
> 27282 C 20 12 1694519734 _ 0x0
> 27282 D 20 13 1694519748 _ 0x0
> 27282 E 20 14 1694519762 _ 0x0
> 27282 F 20 15 1694519776 _ 0x0
> 27282 10 20 16 1694519830 _ 0x0
> 27282 11 20 17 1694519842 _ 0x0
> 27282 12 20 18 1694519855 _ 0x0
```

After doing this, the data mining process is complete, and I can load Any random storks level by running

python3 pb_lvlrand.py 27282

I can also specify a level directly through, for example

python3 pb_lvlrand.py 27282 0x0F

In any case..  Patch number 20 allows me to jump into the game and try out playing any random level instead of level 1.

Of course after finishing the level it will not naturally proceed to the next level.  


# JSON Format for specifying custom patches (Deprecated, No longer used)

The replacement is CSV gamestages data.   Please see docs/GAMESTAGES.md

This functionality is not yet checked in Lvlrand, but the expectation is to be able to Add JSON fields for indicating 
the hack-specific level id patch number, or custom ASM template, Instead of log.txt:  when adding a hack to the database.

This allows setting hack-specific requirements for random level section  when Adding a Hack to the database.
For example, some hacks may require setting switch palaces on certain levels.

For this example, JSON fields are added to use Patch #20 for DRAM World, for Level IDs  [ "$135", "$6", "$2", "$F", "$C", "$5", "$3", "$B",
    "$109", "$14", "$107", "$107", "$1", "$10C" "$7", "$10B", "$10F", "$106", "$105", "$102", "$103", "$101", "$1D8" ]

In addition, a  Custom game-picking patch is specified for an extra level Id $123.

For example:
```
   { "added": "2015-06-22 02:10:27 AM", "author": "PangaeaPanga", "author_href": "",
    "description": "Current version: 1.2", "featured": "No", "id": "11374", "length": "18 exit(s)",
    "name": "Super Dram World", "name_href": "http://example.com/11374/example.zip",
    "notes" : "extra notes go here", 
    "picklevel.stdpatchnum" : "20",
    "picklevel.stdlevels" : [ "$135", "$6", "$2", "$F", "$C", "$5", "$3", "$B",
    "$109", "$14", "$107", "$107", "$1", "$10C", "$7", "$10B", "$10F", "$106", "$105", "$102", "$103", "$101", "$1D8" ],
    "picklevel.levelinfo" : { "$6" : {
                                       "patchnum" : 2,  "name" : "Example name for level",  
                                       "difficulty": "9", "displaynumber": "1", "sequence":"0", "valid":"yes", 
                                       "tags" : [ "normal", "kaizo" ] } },
    "custompatches" : [{
        "name" : "patch1",
        "asartemplate" : "!levelid = #%%levelid%%\norg $85d856\n JSR Main\nBNE $3\nJMP $d8a5\norg $85f8f0\nMain:\nLDA !levelnumber\n STA $13bf\nCPX #$03\nBNE .etest\nLDA $0109\nRTS\n.etest:\nRTS\n",
        "levelids" : [ "$123" ]  
    }],
    "authors": "PangaeaPanga", "demo": "No",
    "pat_sha1": "d53b4dd82295fa9765d2bf023b5cf113cfa1a8d2", 
    "pat_sha224": "7a815b5fe8591a7255de168232417cb3488d4161c0e79ac5a63e537f",
    "pat_shake_128": "fS103JtJSMDmc195nfui9tOqvlz-WWtV", 
    "patch": "patch/fS103JtJSMDmc195nfui9tOqvlz-WWtV",
    "patchblob1_key": "bU9uR0NOSExLUzNVTUpDcHktZkhqM0pEMTl2bVRTZWN3dnI1REZjbGQ2WT0=", 
    "patchblob1_name": "pblob_11374_7003deed8b",
    "patchblob1_sha224": "7003deed8bad89e4981fd92cd7dc4260ac9cd4fcab12f16dd8cbc803", 
    "rating": [ "4.3" ],
    "result_sha1": "e876453387f92f645ac58a42650c8ea0f06e71cf", 
    "result_sha224": "9f0f600ba992cc421e128bd771fe72309e41572b9949cdadcec347d3",
    "result_shake1": "ei6vPa66P1H6dJjgLHqsL_JWmSeOD8v7",
    "tags": [ "glitch", "vanilla" ], "tags_href": "",
    "type": "Kaizo: Intermediate", 
    "url": "https://www.smwcentral.net/?p=section&a=details&id=11374",
    "comments": "24 ",
    "comments_href": "#comments"
   }
```

If you created a Hack and can supply these JSON fields for a Hack on SMWc,  then you can add these fields to your JSON file in hacks/<ID>

Hacks not on SMWc require assignemnt of a unique ID number.   For the time being, please use

      python3 tempid.py <FILENAME>
To create a temporary local id.


The hope would be that in a future version Hack creators or users could submit their JSON Hack metadata to be added, and all users of the program would then have access to all games.

-- NOTE That said Python scripts are not suitable anymore for the current databases.   A new GUI interface for RHPAK Submission preparation is being worked on within the Electron application's  Online section for Game Submissions tab.    The interface to create a submission RHPAK file is being made completely graphical,  And there will eventually be a section within that GUI allowing the game creator to define  gamestage records  to be included as an element of their game's RHPAK file.   So that RHPAK files can be submitted complete with game BPS (Patch data) and gamestage records.









