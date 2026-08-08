/**
 * Realistic sqlmap output fixtures for tests. Derived from actual sqlmap
 * 1.8/1.9 stdout so parser/classifier assumptions are tested against
 * production-like text.
 */

export const SQLMAP_VULNERABLE = `[*] starting @ 12:00:00 /2024-01-01/

[INFO] testing connection to the target URL
[INFO] testing if the target URL content is stable
[INFO] target URL content is stable
[INFO] testing if 'q' parameter is injectable
[INFO] testing SQL injection on 'q' with 20 payloads
[INFO] confirming the 'AND boolean-based blind - WHERE or HAVING clause' attack with 20 payloads
[INFO] the back-end DBMS is SQLite
[INFO] heuristics detected web page and generic RDBMS
web server operating system: Linux
web application technology: WSGI, Python
back-end DBMS: SQLite
[INFO] sqlmap identified the following injection point(s) with a total of 23 HTTP(s) requests:
---
Parameter: q (GET)
    Type: boolean-based blind
    Title: AND boolean-based blind WHERE or HAVING clause
    Payload: q=1' AND 7489=7489 AND 'xKmP'='xKmP

    Type: time-based blind
    Title: SQLite > 2.0 AND time-based blind (heavy query)
    Payload: q=1' AND 8310=BLEND(5,5) --+

    Type: UNION query
    Title: Generic UNION query (NULL) - 1 columns
    Payload: q=1' UNION ALL SELECT 1--+
---
[INFO] the back-end DBMS is SQLite
[INFO] fetched data logged to text files under '/tmp/sqlmap/...'
your sqlmap version is outdated
`;

export const SQLMAP_NOT_INJECTABLE = `[*]
[INFO] target URL content is stable
[INFO] testing if the 'q' parameter is injectable
[INFO] testing 'AND boolean-based blind - WHERE or HAVING clause' with 20 payloads
[INFO] the 'q' parameter is not injectable, skipping
[INFO] all tested parameters do not appear to be injectable. If you suspect that there is some kind of protection mechanism involved (e.g. WAF) or that the parameter might not be injectable in a generalized case, please insert the HTTP button from the page above for 'q'.
[...] exiting with code 0
`;

export const SQLMAP_CONNECTION_ERROR = `[CRITICAL] connection refused to connect the target URL. Please check that:
* the target url is reachable from your machine
* the target url is not blocked by a firewall or an IPS
* the network connectivity is working properly
http://127.0.0.1:6543/api/search?q=1&type=all could not be reached
`;

export const SQLMAP_TOOL_CRASH = `Traceback (most recent call last):
  File "/usr/lib/python3.12/site-packages/sqlmap/lib/request/connect.py", line 42, in connect
    ...
sqlmap exited with code 1 before completing the tests
`;

export const SQLMAP_MISSING_BINARY = {
  stdout: '',
  stderr: 'sh: sqlmap: command not found\n',
  exitCode: 127,
};

/** Realistic POST-body verification used by the adapter (q= in --data). */
export const SQLMAP_VULNERABLE_POST = `Parameter injection: q (POST) (state=1)
[INFO] sqlmap identified the following injection point(s) with parameters:
---
Parameter: query (POST)
    Type: boolean-based blind
    Title: AND boolean-based blind - WHERE or HAVING clause
    Payload: query=1' AND 1234=1234 AND 'x'='x
---
[INFO] the back-end DBMS is MariaDB
back-end DBMS: MariaDB 10.3
`;

export function timeOutResult(): { timedOut: true; exitCode: null; stdout: string; stderr: string } {
  return { timedOut: true, exitCode: null, stdout: '[INFO] testing if the target is alive…', stderr: '' };
}