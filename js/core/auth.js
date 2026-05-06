// js/core/auth.js

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isSignUp = false;

export async function initAuth() {
    const overlay = document.getElementById('auth-overlay');
    const authForm = document.getElementById('auth-form');
    const toggleBtn = document.getElementById('toggle-auth-mode');
    const subtitle = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('btn-auth-submit');
    const googleBtn = document.getElementById('btn-google-auth');
    
    const usernameWrapper = document.getElementById('username-wrapper');
    const usernameInput = document.getElementById('auth-username');
    const orgWrapper = document.getElementById('org-wrapper');
    const orgInput = document.getElementById('auth-org');

    // 1. Initial Session Check
    const { data: { session } } = await supabaseClient.auth.getSession();
    handleAuthState(session);

    // 2. Listen for Auth State Changes
    supabaseClient.auth.onAuthStateChange((event, session) => {
        handleAuthState(session);
    });

    // 3. Toggle Mode Logic (Sign In vs Sign Up)
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            isSignUp = !isSignUp;
            
            if (isSignUp) {
                subtitle.innerText = "Create a new account to start analyzing.";
                submitBtn.innerText = "Create Account";
                toggleBtn.innerHTML = "Already have an account? <span class='link'>Sign In</span>";
                usernameWrapper.classList.remove('hidden');
                orgWrapper.classList.remove('hidden');
                usernameInput.required = true;
                orgInput.required = true;
            } else {
                subtitle.innerText = "Sign in to access your local data vault.";
                submitBtn.innerText = "Sign In";
                toggleBtn.innerHTML = "New here? <span class='link'>Create an account</span>";
                usernameWrapper.classList.add('hidden');
                orgWrapper.classList.add('hidden');
                usernameInput.required = false;
                orgInput.required = false;
            }
        });
    }

    // 4. Handle Email/Password Submission
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const username = usernameInput.value;
            const organization = orgInput.value.trim().toLowerCase();

            submitBtn.innerText = isSignUp ? "Creating..." : "Verifying...";
            submitBtn.disabled = true;

            if (isSignUp) {
                // 1. Fetch seat limits for this Org
                const { data: settings } = await supabaseClient
                    .from('org_settings')
                    .select('max_users')
                    .eq('org_id', organization)
                    .single();

                if (!settings) {
                    alert(`The organization "${organization}" is not registered. Please contact your administrator.`);
                    submitBtn.disabled = false;
                    submitBtn.innerText = "Create Account";
                    return;
                }

                // 2. Count existing members to determine role and check capacity
                const { count } = await supabaseClient
                    .from('profiles')
                    .select('*', { count: 'exact', head: true })
                    .eq('org_id', organization);

                // 🚀 ROLE LOGIC: First user is admin, others are users
                const assignedRole = (count === 0) ? 'admin' : 'user';

                // 3. Enforce seat limit
                if (count !== null && count >= settings.max_users) {
                    alert(`Registration Failed: "${organization}" has reached its limit of ${settings.max_users} users.`);
                    submitBtn.disabled = false;
                    submitBtn.innerText = "Create Account";
                    return;
                }

                // 4. Proceed with Supabase Auth Registration
                const { data: authData, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            display_name: username,
                            org_id: organization,
                            role: assignedRole // 🚀 Store role in Auth metadata
                        }
                    }
                });

                if (error) {
                    alert("Signup Error: " + error.message);
                } else if (authData.user) {
                    // 🚀 CRITICAL: Insert into 'profiles' table with the assigned role
                    await supabaseClient.from('profiles').insert([{
                        id: authData.user.id,
                        org_id: organization,
                        email: email,
                        role: assignedRole
                    }]);
                    
                    alert(assignedRole === 'admin' ? 
                        "Organization Created! You have been assigned the Admin role. Please check your email to confirm." : 
                        "Account created! Please check your email for a confirmation link.");
                }
            } else {
                // LOGIN Logic
                const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) alert("Login Error: " + error.message);
            }

            submitBtn.innerText = isSignUp ? "Create Account" : "Sign In";
            submitBtn.disabled = false;
        });
    }

    // 5. Handle Google OAuth Trigger
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin }
            });
            if (error) alert("Google Login Error: " + error.message);
        });
    }
}

/**
 * Validates session and handles B2B onboarding/role assignment for Google users
 */
/**
 * Validates session, handles B2B onboarding, role assignment, 
 * and enforces Organization Expiry and Seat Limits.
 */
async function handleAuthState(session) {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;

    // 1. Safety check: attempt to re-fetch session if null (Brave browser / Redirect fix)
    if (!session) {
        const { data } = await supabaseClient.auth.getSession();
        session = data.session;
    }

    if (session) {
        const user = session.user;
        const orgId = user.user_metadata?.org_id;
        const isSuperAdmin = user.email === 'boruahpriyanuj2004@gmail.com';

        // 🚀 LOGIN CHECK: If user already belongs to an Org, check if that Org is expired
        if (orgId && !isSuperAdmin) {
            const { data: settings } = await supabaseClient
                .from('org_settings')
                .select('expires_at')
                .eq('org_id', orgId)
                .single();

            // Block access if Org is missing or current date is past expires_at
            if (!settings || new Date(settings.expires_at) < new Date()) {
                alert(`Access Denied: The license for "${orgId}" has expired. Please contact your administrator.`);
                await supabaseClient.auth.signOut();
                window.location.reload();
                return;
            }
        }

        // 🚀 GOOGLE ONBOARDING LOGIC: For new users without an Org ID
        if (!orgId) {
            const orgName = prompt("Welcome! Please enter your Organization Name (Company Name) to initialize your workspace:");
            
            if (!orgName || orgName.trim().length < 2) {
                alert("An Organization Name is required to use Krata AI.");
                await supabaseClient.auth.signOut();
                return;
            }

            const organization = orgName.trim().toLowerCase();

            // 1. Fetch Org Settings (Limit and Expiry)
            const { data: settings } = await supabaseClient
                .from('org_settings')
                .select('max_users, expires_at')
                .eq('org_id', organization)
                .single();

            // 2. Validate Registration and Expiry (Bypass for Super Admin)
            if (!isSuperAdmin) {
                if (!settings) {
                    alert(`The organization "${organization}" is not registered in our system.`);
                    await supabaseClient.auth.signOut();
                    return;
                }

                if (new Date(settings.expires_at) < new Date()) {
                    alert(`The license for "${organization}" has expired.`);
                    await supabaseClient.auth.signOut();
                    return;
                }
            }

            // 3. Count existing members to determine role and check capacity
            const { count } = await supabaseClient
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('org_id', organization);
            
            const assignedRole = (count === 0 || isSuperAdmin) ? 'admin' : 'user';

            // 4. Enforce Seat Capacity (Bypass for Super Admin)
            if (!isSuperAdmin && count !== null && count >= settings.max_users) {
                alert(`Registration Failed: This organization is full (${settings.max_users} seats used).`);
                await supabaseClient.auth.signOut();
                return;
            }

            // 5. Update Auth Metadata with Org and Role
            const { error: updateError } = await supabaseClient.auth.updateUser({
                data: { 
                    org_id: organization,
                    display_name: user.user_metadata?.full_name || user.email.split('@')[0],
                    role: assignedRole
                }
            });

            if (!updateError) {
                // 6. Create the profile record in the public table
                await supabaseClient.from('profiles').insert([{ 
                    id: user.id, 
                    org_id: organization, 
                    email: user.email,
                    role: assignedRole 
                }]);

                // 7. Auto-provision Org in settings if it's the Super Admin's first time
                if (isSuperAdmin && !settings) {
                    await supabaseClient.from('org_settings').insert([{
                        org_id: organization,
                        max_users: 100,
                        expires_at: new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString() // 10 years
                    }]);
                }

                window.location.reload(); 
            } else {
                alert("Account update failed: " + updateError.message);
                await supabaseClient.auth.signOut();
            }
            return;
        }

        // Authentication Successful: Hide login screen and boot the app
        overlay.classList.add('auth-hidden');
        window.dispatchEvent(new CustomEvent('user-authenticated', { detail: user }));
    } else {
        // No session found, ensure login screen is visible
        overlay.classList.remove('auth-hidden');
    }
}

export async function logout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

/**
 * UPDATE USER PROFILE
 */
export async function updateUserProfile(newUsername, newOrg) {
    const { data, error } = await supabaseClient.auth.updateUser({
        data: { 
            display_name: newUsername,
            org_id: newOrg.trim().toLowerCase() 
        }
    });

    if (error) throw error;
    return data;
}
