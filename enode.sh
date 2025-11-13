#!/bin/bash
if [ -f ~/.env.private ] ; then
	source ~/.env.private
fi

if [ -z "$NVM_DIR" ]; then
  export NVM_DIR="$HOME/.nvm"
fi
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # Load nvm and current node version
  . "$NVM_DIR/nvm.sh"
fi

ELECTRON_RUN_AS_NODE=1 npx electron -i "$@"

