'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';

export default function SettingsPage() {
    const router = useRouter();
    const { currentUser, loading: authLoading } = useAuth();

    // Redirect if not authenticated
    useEffect(() => {
        if (!authLoading && !currentUser) {
            router.push('/login');
        }
    }, [authLoading, currentUser, router]);

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!currentUser) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200">
                <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
                    <Link
                        href="/dashboard"
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
                        <p className="text-sm text-gray-500">Account preferences</p>
                    </div>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-8">
                {/* Account Info */}
                <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h2 className="font-semibold text-gray-900 mb-4">Account</h2>
                    <div className="text-gray-600">
                        <p><span className="text-gray-400">Email:</span> {currentUser.email}</p>
                    </div>
                </div>
            </main>
        </div>
    );
}
