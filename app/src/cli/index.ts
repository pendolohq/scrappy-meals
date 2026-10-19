// Admin CLI. In the container: `docker compose exec app scrappy <command>`.
// Locally: `pnpm cli <command>`.
//
// Accounts can only be created here, by someone with shell access to the
// server. Passwords are read from a hidden prompt (or stdin when piped) and
// stored as argon2id hashes; they never touch env vars, files or logs.
import { parseArgs } from "node:util";

import { createDb } from "../server/db/client";
import {
  createUser,
  listUsers,
  MIN_PASSWORD_LENGTH,
  removeUser,
  setPassword,
  UserError,
} from "../server/users";

import { ask } from "./prompt";

const USAGE = `Usage: scrappy <command>

  user add [--name NAME] [--email EMAIL]   create a user (prompts for password)
  user passwd EMAIL                        set a new password; signs out their sessions
  user list                                list users
  user remove EMAIL [--yes]                delete a user and their portions/adherence
`;

async function askNewPassword(): Promise<string> {
  const password = await ask(`Password (min ${MIN_PASSWORD_LENGTH} chars): `, {
    hidden: true,
  });
  const again = await ask("Repeat password: ", { hidden: true });
  if (password !== again) {
    throw new UserError("Passwords do not match");
  }
  return password;
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      email: { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [group, command, arg] = positionals;
  if (values.help || group !== "user" || !command) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new UserError("DATABASE_URL must be set");
  }
  const { db, pool } = createDb(url, { max: 1 });

  try {
    switch (command) {
      case "add": {
        const name = values.name ?? (await ask("Name: "));
        const email = values.email ?? (await ask("Email: "));
        const user = await createUser(db, {
          name,
          email,
          password: await askNewPassword(),
        });
        console.log(`Created ${user.name} <${user.email}>`);
        return 0;
      }
      case "passwd": {
        if (!arg) {
          throw new UserError("Usage: scrappy user passwd EMAIL");
        }
        await setPassword(db, arg, await askNewPassword());
        console.log(
          `Password updated for ${arg}; existing sessions are signed out`
        );
        return 0;
      }
      case "list": {
        const rows = await listUsers(db);
        if (rows.length === 0) {
          console.log("No users yet. Create one with: scrappy user add");
        }
        for (const u of rows) {
          console.log(
            `${u.email}\t${u.name}\tcreated ${u.createdAt.toISOString().slice(0, 10)}`
          );
        }
        return 0;
      }
      case "remove": {
        if (!arg) {
          throw new UserError("Usage: scrappy user remove EMAIL");
        }
        if (!values.yes) {
          const answer = await ask(
            `Delete ${arg} and all their portions and adherence? Type the email to confirm: `
          );
          if (answer.toLowerCase() !== arg.toLowerCase()) {
            throw new UserError("Not confirmed; nothing deleted");
          }
        }
        await removeUser(db, arg);
        console.log(`Removed ${arg}`);
        return 0;
      }
      default:
        process.stdout.write(USAGE);
        return 2;
    }
  } finally {
    await pool.end();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(
      err instanceof UserError || err?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
        ? err.message
        : err
    );
    process.exit(1);
  }
);
