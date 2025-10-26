#~/BizHawk/EmuHawkMono.sh $*
set -x
pwd
echo $*
~/BizHawk/EmuHawkMono.sh --luaconsole --lua=$(pwd)/overworld_extraction.lua  $(pwd)/$*



#/Applications/RetroArch.app/Contents/MacOS/RetroArch -L /Applications/RetroArch.app//Contents/Resources/cores/snes9x2002_libretro.dylib  $*
