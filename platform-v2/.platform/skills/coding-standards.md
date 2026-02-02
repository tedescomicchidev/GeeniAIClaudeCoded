# Coding Standards

## General Principles

- Write clean, readable, and maintainable code
- Follow the principle of least surprise
- Keep functions small and focused (single responsibility)
- Use meaningful variable and function names
- Avoid premature optimization

## TypeScript/JavaScript

- Use TypeScript strict mode for all backend code
- All exported functions must have JSDoc comments with @param and @return
- Use `const` by default, `let` only when reassignment is needed
- Prefer async/await over raw Promises
- Use optional chaining (?.) and nullish coalescing (??) appropriately
- Avoid `any` type - use `unknown` and type guards instead

## Commit Messages

Use conventional commits format:
- `feat(scope): description` - New feature
- `fix(scope): description` - Bug fix
- `refactor(scope): description` - Code refactoring
- `test(scope): description` - Adding or updating tests
- `docs(scope): description` - Documentation changes
- `chore(scope): description` - Maintenance tasks

## Error Handling

- Never swallow errors silently
- Use structured logging (pino recommended)
- Include context in error messages (what operation failed, with what inputs)
- Throw typed errors when possible
- Handle async errors with try/catch

## Testing

- Minimum one test per acceptance criterion
- Use vitest for TypeScript projects, pytest for Python
- Test file naming: `*.test.ts` or `*.spec.ts`
- Cover happy path, edge cases, and error scenarios
- Mock external dependencies

## Branch Naming

- `feature/STORY-XXX-short-description` - New features
- `fix/STORY-XXX-short-description` - Bug fixes
- `refactor/STORY-XXX-short-description` - Refactoring

## PR Guidelines

- Maximum 400 lines changed per PR
- If larger, split the story into smaller stories
- Include tests with implementation
- Update documentation if API changes
- Ensure CI passes before marking complete
