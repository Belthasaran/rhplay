#!/bin/bash

curl -X POST 'https://id.twitch.tv/oauth2/revoke' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-d 'client_id='$RHPLAY_TW_CLIENT_ID'&token='$1



