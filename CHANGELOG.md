# Changelog

## [2.0.0](https://github.com/ashveebee/streamforge/compare/v1.8.0...v2.0.0) (2026-11-27)


### ⚠ BREAKING CHANGES

* StreamForge no longer monitors more than one media server. Installs that added extra Jellyfin, Plex or Emby servers keep their sign-in server only; run a separate StreamForge for each other server.

### Features

* add titles to Sonarr/Radarr with options, one or many at a time ([c1e4764](https://github.com/ashveebee/streamforge/commit/c1e4764ac102e5034006e81b68abc09b8030006c))
* clickable titles and viewers in watch history and stats ([b702262](https://github.com/ashveebee/streamforge/commit/b7022626f6c1dc880ea18fa311decb030f6e6e59))
* count plays and check libraries on every media server ([a63e769](https://github.com/ashveebee/streamforge/commit/a63e7699c5c47db8f7d51709aeb19f7d1ed6a667))
* filter playback stats by media server ([15f2935](https://github.com/ashveebee/streamforge/commit/15f2935a3708ab0b5cffc5b95ab77e8fc0425ce8))
* give Emby and Plex their own pages, sidebar entries and settings cards ([b7b379a](https://github.com/ashveebee/streamforge/commit/b7b379a16c0ed91ad1f45dcfd02bd5d49a78c0cd))
* group the Settings services tab by what each app does ([f2706e0](https://github.com/ashveebee/streamforge/commit/f2706e063e40e25fa5dcf924a510d8ca8d0993ab))
* let Emby-only households sign in with Emby ([5ee3bfe](https://github.com/ashveebee/streamforge/commit/5ee3bfee51c85b3959f2b1c7764c985b1face210))
* let Plex-only households use StreamForge with Sign in with Plex ([2c235be](https://github.com/ashveebee/streamforge/commit/2c235be240214b6dfb60f0db4e8fe02a132ad5f6))
* make Kometa collections from StreamForge ([4a1d6bb](https://github.com/ashveebee/streamforge/commit/4a1d6bbc2895cb6cdb0cd000e4a40509b65b2764))
* monitor Emby and Plex servers alongside Jellyfin ([cd53049](https://github.com/ashveebee/streamforge/commit/cd53049af15cebd6edf153e3548d49298dd5e0d7))
* one media server per install, and a setup step that finds your apps ([d57ac06](https://github.com/ashveebee/streamforge/commit/d57ac06102cf09228add9f931e7a82981010c63d))
* Plex and Emby support, watch history for every user, Kometa collections and bulk add to Sonarr/Radarr ([cbc8e1b](https://github.com/ashveebee/streamforge/commit/cbc8e1bb57bc0d804464242071ad796bd4e99c8b))
* posters and media server filter in watch history ([4628d42](https://github.com/ashveebee/streamforge/commit/4628d42edff4633cecdcb2809fefdccb9e5e0f36))
* show Kometa runs, errors and changes from its webhooks ([79b5cea](https://github.com/ashveebee/streamforge/commit/79b5ceac4fd8d7cbc548af048e4704513fab6e53))
* show what every user has watched, and remove it in bulk ([340bead](https://github.com/ashveebee/streamforge/commit/340bead45a720e7b0ff2dbcd516cd17e54ba8a48))
* show which servers have a title, with each copy, on title pages ([165ed86](https://github.com/ashveebee/streamforge/commit/165ed8626432906a296d8ac59ae87c33ff3d15a8))
* watch history for every user ([5171d8e](https://github.com/ashveebee/streamforge/commit/5171d8ed071ea4a2d7b93adf95bf7559baa00683))


### Bug Fixes

* create an empty Kometa file for every library up front ([0cfd8cf](https://github.com/ashveebee/streamforge/commit/0cfd8cff263ea40fe208d9a5e61d6d7febe34b48))
* keep one-server installs uncluttered ([78e2618](https://github.com/ashveebee/streamforge/commit/78e2618e3534ff15c9fa5fa49134fcd8a3c048c3))
* switch off the apps left out of setup ([07147d7](https://github.com/ashveebee/streamforge/commit/07147d70c858f4652c87879c216f1f7886173d70))
* title pages, search, stats and history for Plex and Emby installs ([fd4f6a0](https://github.com/ashveebee/streamforge/commit/fd4f6a0db7384f51f8407b5089f5206300be24dd))


### Documentation

* add install, media server, Kometa and other guides, published on the website ([9a7b3ad](https://github.com/ashveebee/streamforge/commit/9a7b3ada2ef90d00610087ba6f5184868042c322))
* add Reddit community banner and icon ([a73087b](https://github.com/ashveebee/streamforge/commit/a73087b1c4565253a5ae1521e4b9fce6156dedf6))
* new screenshots and website for one server and two-step setup ([f28540e](https://github.com/ashveebee/streamforge/commit/f28540e62bd98aec1a89658404f2c543d603ec07))
* refresh screenshots with Emby and Plex servers ([b6a057f](https://github.com/ashveebee/streamforge/commit/b6a057f35533bfce800c89eb991beb18c3539af2))
* **site:** mention Emby and Plex support and multiple media servers ([0733b11](https://github.com/ashveebee/streamforge/commit/0733b112650eaddbb0a7959d781210c702e0a9a8))

## [1.8.0](https://github.com/ashveebee/streamforge/compare/v1.7.0...v1.8.0) (2026-11-25)


### Features

* find Jellyfin servers on the network and monitor more than one ([5585072](https://github.com/ashveebee/streamforge/commit/55850724b2e92b1c5ce0189d6e0b252396ea49e0))
* find Jellyfin servers on the network and monitor more than one ([68f4822](https://github.com/ashveebee/streamforge/commit/68f482240d7a0016bb91b4271bf5df9cad8793a6))


### Documentation

* **site:** mention Jellyfin discovery and multiple servers ([6f8868d](https://github.com/ashveebee/streamforge/commit/6f8868de562a4e269eb2efe85b82e32d184043a2))

## [1.7.0](https://github.com/ashveebee/streamforge/compare/v1.6.0...v1.7.0) (2026-11-25)


### Features

* buffering diagnosis, device playability, update notices and a tidier Settings ([8a62d99](https://github.com/ashveebee/streamforge/commit/8a62d993a224d772ea768c8da71631c63a76ba8e))
* explain why a stream buffered ([1908fb4](https://github.com/ashveebee/streamforge/commit/1908fb433c768cbd0d3f6edcb42bf2c029f6c606))
* learn what each device can play, and predict it for the library ([20ab29e](https://github.com/ashveebee/streamforge/commit/20ab29e6f20913d9c3a17568bcefb76a64b597c3))
* tell admins when a new StreamForge release is out ([e627611](https://github.com/ashveebee/streamforge/commit/e6276111d7620ae399e930694a74b54670fefd68))

## [1.6.0](https://github.com/ashveebee/streamforge/compare/v1.5.0...v1.6.0) (2026-11-24)


### Features

* every episode of a season, including missing ones ([c58a49c](https://github.com/ashveebee/streamforge/commit/c58a49c30506f4de28ab37c1f3144cc2807deb2c))
* every episode with details, Moonfin support, and phone layout fixes ([6de7feb](https://github.com/ashveebee/streamforge/commit/6de7feb28bfe4f26962cc883bd11e89f23de2b97))
* open titles in Moonfin ([49462b5](https://github.com/ashveebee/streamforge/commit/49462b50867bd2d22de682b9d6e7501b550bc4ec))


### Bug Fixes

* Sonarr, Radarr and System pages run off the screen on phones ([69c53ea](https://github.com/ashveebee/streamforge/commit/69c53eac86452629327a2f8dda6f72b506e99502))

## [1.5.0](https://github.com/ashveebee/streamforge/compare/v1.4.0...v1.5.0) (2026-11-24)


### Features

* public address for each service ([598dc03](https://github.com/ashveebee/streamforge/commit/598dc03ea6de5c7719e507e6b66080021f6e1168))
* public service addresses, iPhone app fix and a richer website ([eea35cb](https://github.com/ashveebee/streamforge/commit/eea35cb2deaf194027788f60c997143a6a1af992))


### Bug Fixes

* menu and search buttons can't be tapped in the iPhone app ([4b25c4b](https://github.com/ashveebee/streamforge/commit/4b25c4bc5c89da459d47fbc40b3b649460854c7f))


### Documentation

* show what StreamForge can do on the website ([55b9d29](https://github.com/ashveebee/streamforge/commit/55b9d292f53ee4da2b01cf1359f0a9e6fc91eba8))

## [1.4.0](https://github.com/ashveebee/streamforge/compare/v1.3.0...v1.4.0) (2026-11-24)


### Features

* Jellyfin library details on title pages, and fix the page on phones ([c7f809d](https://github.com/ashveebee/streamforge/commit/c7f809dcc5c64288b3d4f94de77358df937f00f0))
* Jellyfin library details on title pages, and fix the page on phones ([61625b4](https://github.com/ashveebee/streamforge/commit/61625b4e5c0338ea1ff5f4bbfd4bf59b8b45b58e))

## [1.3.0](https://github.com/ashveebee/streamforge/compare/v1.2.1...v1.3.0) (2026-11-24)


### Features

* details page for every movie and show ([b8fbefb](https://github.com/ashveebee/streamforge/commit/b8fbefbc9af255fd60ae99ec8c5df2cf6444b7b6))
* title details pages, a loader on every page, and fix pages needing a hard refresh ([c23c511](https://github.com/ashveebee/streamforge/commit/c23c511667e6efa454da8ccc153801e28fc32e34))


### Bug Fixes

* pages that wouldn't load until a hard refresh, and a loader on every page ([fe3cff2](https://github.com/ashveebee/streamforge/commit/fe3cff265f437852e6fe528e44a29098e3e32ba9))

## [1.2.1](https://github.com/ashveebee/streamforge/compare/v1.2.0...v1.2.1) (2026-11-24)


### Bug Fixes

* search crash, requesting from search, and a loader for slow pages ([c42d186](https://github.com/ashveebee/streamforge/commit/c42d1864169d466d0216fcdaadbf455bf0391012))
* search crash, requesting from search, and a loader for slow pages ([8a23ee3](https://github.com/ashveebee/streamforge/commit/8a23ee33c62620877dcc6bdb04fdc725f755aa43))

## [1.2.0](https://github.com/ashveebee/streamforge/compare/v1.1.0...v1.2.0) (2026-11-24)


### Features

* audit log of changes and sign-ins ([73407e2](https://github.com/ashveebee/streamforge/commit/73407e2bda09101f83900d2b1d2ff9fe9c55ccdc))
* Bazarr, Lidarr and Readarr integrations ([38e1a03](https://github.com/ashveebee/streamforge/commit/38e1a033b76cadd5ba94279d6ab6fce52f24d0c5))
* cleanup suggestions for big titles nobody watches ([55f593f](https://github.com/ashveebee/streamforge/commit/55f593f9d1964093124cc979aa85d4ad246b130f))
* download clients (qBittorrent, Transmission, SABnzbd, NZBGet) ([f15737e](https://github.com/ashveebee/streamforge/commit/f15737ed7a8292e07264a74db7ed20ba872e4fd2))
* encrypted settings backup and restore ([0725101](https://github.com/ashveebee/streamforge/commit/07251018b36c883c96d5711058b79503d35362f9))
* global search with request and add actions ([be242b9](https://github.com/ashveebee/streamforge/commit/be242b95021b6ca2c2b842670b7ec950ff0e38ec))
* Jellyfin scheduled tasks and library scans ([3cf2282](https://github.com/ashveebee/streamforge/commit/3cf228279566021c770e76ae6f294c3236dfb97a))
* keep sign-in sessions across restarts ([3f99d78](https://github.com/ashveebee/streamforge/commit/3f99d782200c45fb02ce7384eaa00992d85c37bd))
* keep sign-in sessions across restarts ([8ef3fee](https://github.com/ashveebee/streamforge/commit/8ef3fee72cc558bdd791b70afd5ef82eade0b77e))
* personal activity page for every user ([5b76ce1](https://github.com/ashveebee/streamforge/commit/5b76ce17af510a8e83a6e2d6af8cf50e2c8c7a40))
* rules engine for simple automations ([2775738](https://github.com/ashveebee/streamforge/commit/27757386a99b8afa51ee29263bfbaf4b3f03556e))
* single sign-on (OpenID Connect) and two-factor sign-in ([3b5eec2](https://github.com/ashveebee/streamforge/commit/3b5eec2d0ee96b2b073f0b9382fe7518c063f24c))
* transcode and bandwidth alerts ([60e0978](https://github.com/ashveebee/streamforge/commit/60e0978407f6551d6881cccdfa6d16faeab39532))
* weekly digest ([9d46165](https://github.com/ashveebee/streamforge/commit/9d4616581cf37f909c1a2ab9309a9d37f419b134))


### Bug Fixes

* demo data for the new pages, and small robustness fixes ([c8099d6](https://github.com/ashveebee/streamforge/commit/c8099d6139a983d2ff2fb0774a709198b3134daf))


### Documentation

* describe the new features in the README ([486e0ca](https://github.com/ashveebee/streamforge/commit/486e0ca8d49da3d3b887e15f83a6a1130a32f3e2))
* new screenshots, and the new features on the website and README ([599f2fa](https://github.com/ashveebee/streamforge/commit/599f2fa9665273aaa34b7c85e1b8eac1bddbcdf1))

## [1.1.0](https://github.com/ashveebee/streamforge/compare/v1.0.3...v1.1.0) (2026-11-23)


### Features

* approve and decline Seerr requests ([4989862](https://github.com/ashveebee/streamforge/commit/498986256f9bd414b1398b82f9dccbd87f98dd22))
* auto-import, download cleanup, notifications, stats, library health and more ([7671c8a](https://github.com/ashveebee/streamforge/commit/7671c8a2c2101503dddb121c7ad51b6ac27eb7b5))
* control Jellyfin streams from Now Playing ([347155b](https://github.com/ashveebee/streamforge/commit/347155b31db0f9ec4dfd2ea6e9649ed1a6f2a188))
* installable app (PWA) ([6ef27d4](https://github.com/ashveebee/streamforge/commit/6ef27d4b9e66f818d0ac97e15b6928e13fbfaacb))
* library health page ([301df6f](https://github.com/ashveebee/streamforge/commit/301df6fdf75a6ccaa0c5e5f32023996ff24a0b07))
* member access for non-admin Jellyfin users ([01d5a4d](https://github.com/ashveebee/streamforge/commit/01d5a4dea15c0ff465e46167d8cc11e79a909408))
* missing episodes and movies with search buttons ([c793559](https://github.com/ashveebee/streamforge/commit/c7935598f9a32864431951000fa986b6475fc94b))
* multiple Sonarr/Radarr instances and Radarr auto-import ([5fb39e6](https://github.com/ashveebee/streamforge/commit/5fb39e6cf73d0642f0ce20819de612e08bebd00f))
* notifications via Discord, ntfy, Pushover, webhooks and web push ([39b0868](https://github.com/ashveebee/streamforge/commit/39b08684f0a14373e8f96b7100137e8afdb698b0))
* playback stats page ([42ae8dc](https://github.com/ashveebee/streamforge/commit/42ae8dc0d8bed5b18d7f61211f16943843f9ae24))
* queue actions for Sonarr/Radarr downloads ([a501f33](https://github.com/ashveebee/streamforge/commit/a501f334724b6f564906feb0a9ce294bbd56014a))
* Sonarr auto-import for unmatched downloads, and enable/disable services ([983dd1a](https://github.com/ashveebee/streamforge/commit/983dd1aa90485edc4cd8654cfa3287f66da03cf1))
* stalled and failed download cleanup ([07ed71f](https://github.com/ashveebee/streamforge/commit/07ed71fc9eaac6fc5465c33903e60c5e48742d5a))
* storage forecast and disk-full alerts ([ea7b4ab](https://github.com/ashveebee/streamforge/commit/ea7b4ab250d6347d4d5eaaad9b468ebb7360e809))


### Documentation

* describe the new features in the README ([01bfc3e](https://github.com/ashveebee/streamforge/commit/01bfc3ee4227b4871b97c6769e805bed39cf3c9f))
* refresh screenshots and add Stats and Library health ([9a65b25](https://github.com/ashveebee/streamforge/commit/9a65b25e9699574661ea3b11d504381ef936716f))
* **site:** add the new features to the project website ([52d57d6](https://github.com/ashveebee/streamforge/commit/52d57d696134ea4c45d22ab4c2783b2214619e5d))

## [1.0.3](https://github.com/ashveebee/streamforge/compare/v1.0.2...v1.0.3) (2026-11-23)


### Documentation

* add GPL-2.0 license and project website ([33b45a6](https://github.com/ashveebee/streamforge/commit/33b45a66c815bf5455bcef6c0d9dbb8fff6521d8))
* add PolyForm Noncommercial license and project website ([2feef4a](https://github.com/ashveebee/streamforge/commit/2feef4aae1d6de50e81155c03a67799584f0c3c4))
* license under GPL-2.0-only instead of PolyForm Noncommercial ([72c2d05](https://github.com/ashveebee/streamforge/commit/72c2d05f6e82977a24e7b01a7725b63ad3a82c89))

## [1.0.2](https://github.com/ashveebee/streamforge/compare/v1.0.1...v1.0.2) (2026-11-23)


### Documentation

* add screenshots and a demo mode ([412dce9](https://github.com/ashveebee/streamforge/commit/412dce9706c7aaad9df7f331799643a826151268))
* add screenshots and a demo mode ([7e1038a](https://github.com/ashveebee/streamforge/commit/7e1038a6a12f9b48342055f4b97cb8a08c15bdfa))

## [1.0.1](https://github.com/ashveebee/streamforge/compare/v1.0.0...v1.0.1) (2026-11-23)


### Bug Fixes

* **deps:** bump Node from 22 to 26 ([33b0680](https://github.com/ashveebee/streamforge/commit/33b06805c0f48d552197f33b004c871fa9678f0c))
* **deps:** Bump node from 22-alpine to 26-alpine ([2e318ab](https://github.com/ashveebee/streamforge/commit/2e318ab5fbaa8c559993d5001ed8a3ab54826b01))

## 1.0.0 (2026-11-23)


### Features

* automated semantic releases and multi-arch Docker images ([d4a456f](https://github.com/ashveebee/streamforge/commit/d4a456fcd2bb79ec33c54ec123b4dbb7e8fe6165))
* manage service settings from the UI ([41e260c](https://github.com/ashveebee/streamforge/commit/41e260cd53b4032b773138ea14b8135dfcbcda81))
