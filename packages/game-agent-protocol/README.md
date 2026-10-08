# Game Agent protocol

Authoring request/result schemas shared by Studio, Server and the independent
Harness service. This package contains types and validation only. It does not
depend on Agent OS's `fizz.agent.v1` events, execution state or journals.

Player appearance and game-source schemas are reused from `@repo/shared`;
authoring messages are kept separate from the player runtime contract.
