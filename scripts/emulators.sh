#!/bin/sh
# Local Firebase emulators (Realtime Database + Auth) for development and the load test. Needs Java 21+.
if [ -z "$JAVA_HOME" ] && command -v brew >/dev/null 2>&1 && [ -d "$(brew --prefix openjdk 2>/dev/null)" ]; then
  JAVA_HOME="$(brew --prefix openjdk)"
fi
[ -n "$JAVA_HOME" ] && PATH="$JAVA_HOME/bin:$PATH"
export JAVA_HOME PATH
exec npx firebase emulators:start --only database,auth --project demo-livequiz "$@"
