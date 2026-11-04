# Custom update delivery repair

## Goal and approved scope
Repair NEXT-001 without client GitHub credentials. The user approved public
visibility for the entire customization repository, conditional on privacy
checks. Do not change upstream, main, SSH features, user data or plugin rights.
Retain anonymous discovery; ad-hoc macOS packages use manual installation.

## Baseline
The source still routes release links and builder configuration upstream, while
published local.1 used a packaging override. Private anonymous discovery returns
404; local-v tags are not semver; stable-only discovery excludes prereleases;
release assets lack feed metadata. Raw network errors cross IPC and logs.

## Delivery constraints
Linux can verify the controller, real provider, metadata and JS build, not native
macOS packaging or install acceptance. No release, commit, push or merge is
implied. Existing releases remain unchanged; a new Mac build is a bootstrap step.
