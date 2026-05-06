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

    // 2. Listen for Auth State Changes (Handles redirects after Google Login)
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
                // 🚀 START SEAT LIMIT CHECK
                // 1. Fetch the limit for this Org
                const { data: settings } = await supabaseClient
                    .from('org_settings')
                    .select('max_users')
                    .eq('org_id', organization)
                    .single();

                // Note: In this logic, if an Org isn't in 'org_settings', 
                // we block sign-up (assuming Admin must provision it first).
                if (!settings) {
                    alert(`The organization "${organization}" is not registered in our system. Please contact your admin.`);
                    submitBtn.disabled = false;
                    submitBtn.innerText = "Create Account";
                    return;
                }

                // 2. Count existing members in the profiles table
                const { count, error: countErr } = await supabaseClient
                    .from('profiles')
                    .select('*', { count: 'exact', head: true })
                    .eq('org_id', organization);

                // 3. Enforce the limit
                if (count !== null && count >= settings.max_users) {
                    alert(`Registration Failed: "${organization}" has reached its limit of ${settings.max_users} users.`);
                    submitBtn.disabled = false;
                    submitBtn.innerText = "Create Account";
                    return;
                }
                // 🚀 END SEAT LIMIT CHECK

                // Proceed with Registration
                const { data: authData, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            display_name: username,
                            org_id: organization
                        }
                    }
                });

                if (error) {
                    alert("Signup Error: " + error.message);
                } else if (authData.user) {
                    // 🚀 CRITICAL: Insert into 'profiles' so the user is counted immediately
                    await supabaseClient.from('profiles').insert([{
                        id: authData.user.id,
                        org_id: organization,
                        email: email
                    }]);
                    alert("Success! Check your email for a confirmation link.");
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
                options: {
                    redirectTo: window.location.origin
                }
            });
            if (error) alert("Google Login Error: " + error.message);
        });
    }
}

/**
 * Validates session and handles B2B onboarding for Google users
 */
async function handleAuthState(session) {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;

    if (session) {
        const user = session.user;
        const orgId = user.user_metadata?.org_id;

        if (!orgId) {
            const orgName = prompt("Welcome! Please enter your Organization Name (Company Name) to initialize your workspace:");
            
            if (!orgName || orgName.trim().length < 2) {
                alert("An Organization Name is required to use Krata AI.");
                await supabaseClient.auth.signOut();
                return;
            }

            const organization = orgName.trim().toLowerCase();

            // 🚀 SEAT LIMIT CHECK FOR GOOGLE USERS
            const { data: settings } = await supabaseClient.from('org_settings').select('max_users').eq('org_id', organization).single();
            if (!settings) {
                alert(`The organization "${organization}" is not registered.`);
                await supabaseClient.auth.signOut();
                return;
            }

            const { count } = await supabaseClient.from('profiles').select('*', { count: 'exact', head: true }).eq('org_id', organization);
            if (count !== null && count >= settings.max_users) {
                alert(`This organization is full (${settings.max_users} seats used).`);
                await supabaseClient.auth.signOut();
                return;
            }

            // Update user metadata
            const { error } = await supabaseClient.auth.updateUser({
                data: { 
                    org_id: organization,
                    display_name: user.user_metadata?.full_name || user.email.split('@')[0]
                }
            });

            if (!error) {
                // 🚀 Create profile for Google user
                await supabaseClient.from('profiles').insert([{ id: user.id, org_id: organization, email: user.email }]);
                window.location.reload(); 
            }
            return;
        }

        overlay.classList.add('auth-hidden');
        window.dispatchEvent(new CustomEvent('user-authenticated', { detail: user }));
    } else {
        overlay.classList.remove('auth-hidden');
    }
}

export async function logout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

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
