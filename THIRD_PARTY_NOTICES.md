# Third Party Notices

This project is based on open-source software and external dictionary services.

## 1) Upstream Project Attribution

- Upstream project: `white0dry/read-something`
- URL: <https://github.com/white0dry/read-something>
- Note: this repository is a derivative/remix based on the upstream project.

## 2) Online Dictionary/Data Services

The following services may be used for vocabulary enrichment over network requests:

- Free Dictionary API (`dictionaryapi.dev`)
  - URL: <https://dictionaryapi.dev/>
  - Usage: fetch phonetic / definition / example for English words
- Datamuse API
  - URL: <https://www.datamuse.com/api/>
  - Usage: fallback lexical metadata (definition tags / pron / part-of-speech hints)
- Urban Dictionary endpoint (`api.urbandictionary.com/v0/define`)
  - URL: <https://api.urbandictionary.com/v0/define?term=example>
  - Usage: slang-oriented fallback definitions

Please follow each provider's terms, rate limits, and availability policy.

## 3) Optional Offline Dictionary Source

- ECDICT
  - URL: <https://github.com/skywind3000/ECDICT>
  - License: MIT
  - License file: <https://github.com/skywind3000/ECDICT/blob/master/LICENSE>

Note: ECDICT data is not bundled into this repository by default at this time.
