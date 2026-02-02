# Security Guidelines

## Input Validation

- Validate all user input on the server side
- Use allow-lists over deny-lists
- Sanitize inputs before database queries
- Limit input lengths to prevent DoS

## Authentication & Authorization

- Never store plaintext passwords
- Use bcrypt with cost factor >= 12 for password hashing
- Implement rate limiting on auth endpoints
- Use secure, HttpOnly, SameSite cookies for sessions
- Implement proper RBAC for authorization

## Secrets Management

- Never commit secrets to git
- Use environment variables or secrets managers
- Rotate secrets regularly
- Different secrets per environment

## Data Protection

- Encrypt sensitive data at rest
- Use HTTPS/TLS for data in transit
- Implement proper access controls
- Log access to sensitive data

## Common Vulnerabilities to Avoid

### SQL Injection
- Use parameterized queries or ORM
- Never concatenate user input into queries

### XSS (Cross-Site Scripting)
- Escape output in HTML contexts
- Use Content Security Policy headers
- Sanitize HTML input if allowing rich text

### CSRF (Cross-Site Request Forgery)
- Use CSRF tokens for state-changing requests
- Verify Origin/Referer headers

### Command Injection
- Avoid shell execution with user input
- Use library functions instead of shell commands
- If shell is necessary, use allow-list validation

## Dependencies

- Keep dependencies updated
- Use lockfiles (package-lock.json, yarn.lock)
- Run security audits regularly (npm audit, pip audit)
- Review new dependencies before adding
