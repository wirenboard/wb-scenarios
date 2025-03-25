# Note about compat

Needed compat 11 because 'dh_installsystemd' was created in October 2017:

- https://salsa.debian.org/debian/debhelper/-/blame/main/dh_installsystemd

And the first changelog entry in compat 11:

- https://tracker.debian.org/news/894669/accepted-debhelper-11-source-into-unstable/

```text
   * dh_installsystemd: Remove neutering of dh_installsystemd in compat
     levels prior to 11 now that compat 11 is stable.
```
