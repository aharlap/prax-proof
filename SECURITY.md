# Security policy

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities or include real learner
data, credentials, or live ingest keys in a report. Use GitHub's private
[security advisory form](https://github.com/Praxity/prax-proof/security/advisories/new).

Include the affected commit or deployment version, reproduction steps, impact,
and a minimal proof of concept using synthetic data. Maintainers will acknowledge
a complete report as capacity permits and coordinate disclosure after a fix is
available.

## Supported versions

Proof is pre-release. Security fixes target the current `main` branch; older
commits and private forks are not maintained by Praxity.

Operators are responsible for applying migrations and updates, using HTTPS and a
strong unique admin password, scoping and rotating keys, configuring retention,
and meeting the security and privacy obligations of their deployment.
