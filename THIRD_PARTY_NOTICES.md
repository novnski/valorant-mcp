# Third-party notices

## Riot Games

Valorant MCP was created under Riot Games' [Legal Jibber Jabber](https://www.riotgames.com/en/legal) policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.

VALORANT, character names, maps, weapon artwork, and other game content belong to Riot Games. The bundled content in `assets/valorant/` is excluded from the project's MIT license. This is a free community fan project; the code license does not grant rights to commercialize Riot's content or marks.

The local game knowledge catalog is generated from [Valorant-API](https://valorant-api.com/). Its bundled snapshot may lag a game patch. The project does not claim official Riot API approval or affiliation.

## External data

- [HenrikDev](https://docs.henrikdev.xyz/) provides player and match data. Each user supplies their own API key and follows the provider's access rules and quota.
- [Strats.gg](https://strats.gg/valorant) provides community lineups. Results preserve provider/creator references and link to provider media. This server does not download or redistribute lineup videos.
- Tracker.gg links are decoded locally into identifiers; Tracker is not queried or scraped.

API responses, community submissions, and external media retain their owners' rights. Installing this server does not grant additional rights over that content.

## Software dependencies

Dependencies retain their upstream licenses, included in their installed packages. Principal runtime dependencies are the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Zod](https://github.com/colinhacks/zod), and [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas). Bun is installed separately and supplies the SQLite runtime.

License texts for bundled JavaScript dependencies are included in `licenses/`. Native Canvas dependencies are installed separately with their upstream notices.
