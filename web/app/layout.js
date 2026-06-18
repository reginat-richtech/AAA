import './globals.css';
import Sidebar from './_components/Sidebar';
import Providers from './_components/Providers';
import { auth } from '../auth';
import { isAdmin, touchUser } from '../lib/access';

export const metadata = {
  title: 'AAA — Admin',
  description: 'Admin console for the AAA database',
};

export default async function RootLayout({ children }) {
  const session = await auth();
  const email = session?.user?.email || null;
  if (email) await touchUser(email, session.user?.name);   // record the user so admins see everyone
  const admin = email ? await isAdmin(email) : false;

  return (
    <html lang="en">
      <body>
        <Providers session={session}>
          {email ? (
            <div className="shell">
              <Sidebar email={email} isAdmin={admin} />
              <main className="container">{children}</main>
            </div>
          ) : (
            <main className="container">{children}</main>
          )}
        </Providers>
      </body>
    </html>
  );
}
