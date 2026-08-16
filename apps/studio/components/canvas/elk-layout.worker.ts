// ELK's worker build installs the layout dispatcher on `self`. Keeping this
// entry deliberately tiny gives Turbopack one native Worker boundary and
// avoids nesting the bundled fake-worker implementation inside another worker.
import "elkjs/lib/elk-worker.min.js";
