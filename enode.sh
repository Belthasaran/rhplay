#!/bin/bash
if [ -f ~/.env.private ] ; then
	source ~/.env.private
fi
ELECTRON_RUN_AS_NODE=1 npx electron -i $@

